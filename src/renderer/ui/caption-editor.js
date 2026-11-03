// "Captions" dialog: fix any word in the captions Auto-Edit wrote, keep the karaoke timing, and teach the app your vocabulary
// so it spells those words right next time (and so Whisper is prompted with them).
import { el, toast, fmtTime } from './dom.js';
import { store } from '../store.js';
import { uid, findTrack } from '/shared/project.js';
import { cardFromClip, rebuildCards, retextClip } from '/shared/caption-edit.js';
import { learnCorrections, normalizeGlossary } from '/shared/glossary.js';
import { loadGlossary, saveGlossary } from '../glossary-store.js';

let open = false;

/** Text clips that are captions: on a track called CAP, or carrying karaoke words. Sorted by time. */
export function listCaptionClips(project) {
  const capIds = new Set(project.tracks.filter((t) => t.name === 'CAP').map((t) => t.id));
  return project.clips.filter((c) => c.type === 'text' && (capIds.has(c.trackId) || c.text?.karaoke)).sort((a, b) => a.start - b.start);
}

export const captionCards = (project) => listCaptionClips(project).map(cardFromClip);

const flat = (s) => s.replace(/\n/g, '');
const parseVocab = (text) => normalizeGlossary(text.split('\n').map((l) => { const m = l.split(/\s*(?:=>|→|->|=)\s*/); return m.length >= 2 ? { from: m[0], to: m.slice(1).join(' ') } : null; }).filter(Boolean));
const formatVocab = (list) => list.map((e) => `${e.from} → ${e.to}`).join('\n');

/** Applies the edits in one undo step. `edits` is [{id, text}] (empty text deletes the caption). Returns the corrections learned. */
export function applyCaptionEdits(edits) {
  const p = store.project;
  const learned = [];
  store.snapshot();
  let changed = 0;
  for (const e of edits) {
    const idx = p.clips.findIndex((c) => c.id === e.id);
    if (idx < 0) continue;
    const clip = p.clips[idx], card = cardFromClip(clip);
    if (flat(card.text) === flat(e.text)) continue;
    changed++;
    const cards = rebuildCards(card, e.text);
    if (!cards.length) { p.clips.splice(idx, 1); continue; }
    learned.push(...learnCorrections(flat(card.text), e.text));
    const first = retextClip(clip, cards[0]);
    p.clips[idx] = first;
    cards.slice(1).forEach((cd) => { const extra = retextClip(clip, cd); extra.id = uid('clip'); p.clips.push(extra); });
  }
  if (!changed) { store.undoStack.pop(); return { changed: 0, learned: [] }; }
  store.touch('project');
  store.transcript = { ...(store.transcript || {}), cards: captionCards(p) };
  return { changed, learned: normalizeGlossary(learned) };
}

export function openCaptionEditor() {
  if (open) return;
  const root = document.getElementById('modal-root');
  const clips = listCaptionClips(store.project);
  const rows = clips.map((c) => {
    const track = findTrack(store.project, c.trackId);
    const input = el('input', { type: 'text', value: flat(c.text.content), spellcheck: 'false', 'aria-label': `Caption at ${fmtTime(c.start)}` });
    const time = el('button', { class: 'cap-time', title: 'Jump to this caption', text: fmtTime(c.start).slice(3, 8) + fmtTime(c.start).slice(8, 10) });
    time.onclick = () => store.setPlayhead(c.start + 0.01);
    input.addEventListener('focus', () => store.setPlayhead(c.start + 0.01));
    const del = el('button', { class: 'icon', title: 'Delete this caption', 'aria-label': 'Delete this caption', text: '×' });
    const row = el('div', { class: 'cap-row' }, time, input, del);
    del.onclick = () => { input.value = ''; row.classList.add('gone'); };
    return { clip: c, input, row, track };
  });

  const vocab = el('textarea', { rows: 4, spellcheck: 'false', placeholder: 'ติ๊กต๊อก → TikTok\nแคปชั่น → แคปชัน', value: formatVocab(loadGlossary()) });
  const remember = el('input', { type: 'checkbox', checked: true });
  const close = () => { open = false; root.replaceChildren(); };
  const save = el('button', { class: 'primary', id: 'cap-save', text: 'Apply', onclick: () => {
    const edits = rows.map((r) => ({ id: r.clip.id, text: r.input.value.trim() }));
    const r = applyCaptionEdits(edits);
    let list = parseVocab(vocab.value);
    if (remember.checked && r.learned.length) list = normalizeGlossary([...list, ...r.learned]);
    saveGlossary(list);
    toast(r.changed ? `Updated ${r.changed} caption${r.changed === 1 ? '' : 's'}${remember.checked && r.learned.length ? ` · remembered ${r.learned.length} correction${r.learned.length === 1 ? '' : 's'}` : ''}.` : 'No caption text changed.');
    close();
  } });

  const body = el('div', { class: 'modal cap-modal' },
    el('h3', { text: 'CAPTIONS  ·  แก้คำ + คลังคำศัพท์' }),
    clips.length
      ? el('div', { class: 'cap-list', id: 'cap-list' }, rows.map((r) => r.row))
      : el('div', { class: 'empty', text: 'No captions yet. Run TikTok Auto-Edit first.' }),
    el('section', { class: 'ae-sec' }, el('h4', { text: 'Vocabulary · คำที่ฟังผิดบ่อย' }),
      el('div', { class: 'hint', text: 'One per line: what it wrote → what it should write. Applied to every future transcript, and sent to Whisper as a spelling hint.' }), vocab,
      el('label', { class: 'chk ae-chk' }, remember, 'Remember the corrections I make above')),
    el('div', { class: 'actions' }, el('button', { text: 'Cancel', onclick: close }), save));
  open = true;
  root.replaceChildren(el('div', { class: 'modal-back' }, body));
  rows[0]?.input.focus();
}
