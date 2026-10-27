// "TikTok Auto-Edit" dialog: choose options, download the speech model if needed, run, show what happened.
import { el, toast, fmtTime } from './dom.js';
import { store } from '../store.js';
import { runAutoEdit, pickSourceClip, DEFAULTS, LOOKS } from '../engine/autoedit.js';
import { CAPTION_STYLES } from '/shared/caption-styles.js';
import { serializeSrt } from '/shared/srt.js';
import { findMedia } from '/shared/project.js';
import { openExportDialog } from './export-dialog.js';

const KEY = 'hhlab.autoedit.opts';
const loadOpts = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } };
const saveOpts = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* storage unavailable */ } };
const mb = (n) => `${Math.round(n / 1048576)} MB`;

let open = false;
export const isAutoEditOpen = () => open;

export async function openAutoEdit() {
  if (open) return;
  const root = document.getElementById('modal-root');
  const opts = loadOpts();
  const clip = pickSourceClip(store.project, store.selection);
  const media = clip && findMedia(store.project, clip.mediaId);
  let status = await window.hh.asrStatus().catch(() => null);
  let subtitles = null, subtitleName = '', busy = false, signal = null;

  const row = (label, ...ctl) => el('div', { class: 'ae-row' }, el('label', { text: label }), el('div', { class: 'ae-ctl' }, ctl));
  const check = (key, text, hint) => {
    const i = el('input', { type: 'checkbox', checked: !!opts[key] });
    i.addEventListener('change', () => { opts[key] = i.checked; saveOpts(opts); });
    return el('label', { class: 'chk ae-chk', title: hint || '' }, i, text);
  };
  const select = (key, entries, onChange) => {
    const s = el('select', {}, Object.entries(entries).map(([k, v]) => el('option', { value: k, text: v, ...(k === String(opts[key]) ? { selected: true } : {}) })));
    s.addEventListener('change', () => { opts[key] = s.value; saveOpts(opts); onChange?.(); });
    return s;
  };

  // ---- speech model block
  const modelBox = el('div', { class: 'ae-model' });
  const dlBar = el('div', { class: 'progress', hidden: true }, el('b'));
  const renderModel = () => {
    modelBox.replaceChildren();
    if (!status) { modelBox.append(el('div', { class: 'errbox', text: 'The speech engine is unavailable.' })); return; }
    const m = status.models[opts.model];
    if (subtitles) { modelBox.append(el('div', { class: 'hint', text: `Using subtitle file "${subtitleName}" — no speech model needed.` })); return; }
    if (m.installed) modelBox.append(el('div', { class: 'hint ok', text: `✔ ${m.label} ready (${mb(m.bytes)}). ${m.note}.` }), el('button', { text: 'Remove model', onclick: async () => { await window.hh.asrRemove(opts.model); status = await window.hh.asrStatus(); renderModel(); } }));
    else {
      const dl = el('button', { class: 'primary', text: `Download ${m.label} (≈${m.approxMB} MB)`, onclick: async () => {
        dl.disabled = true; dlBar.hidden = false; dlBar.firstChild.style.width = '0%';
        try { await window.hh.asrDownload(opts.model); status = await window.hh.asrStatus(); toast(`${m.label} downloaded.`); }
        catch (e) { toast(`Download failed: ${e.message}`, 'error'); }
        dlBar.hidden = true; renderModel();
      } });
      modelBox.append(el('div', { class: 'hint', text: `${m.note}. One-time download; everything runs on your computer — your audio is never uploaded.${m.partial ? ` (partial download of ${mb(m.partial)} will resume)` : ''}` }), dl);
    }
  };
  window.hh.onAsrProgress?.((p) => {
    if (!open) return;
    if (p.phase === 'download' && p.total) { dlBar.hidden = false; dlBar.firstChild.style.width = `${(p.received / p.total * 100).toFixed(1)}%`; log.textContent = `Downloading… ${mb(p.received)} / ${mb(p.total)}`; }
    if (p.phase === 'transcribe') setStep('transcribe', `Transcribing… ${Math.round(p.pct)}%`);
  });

  // ---- caption style buttons
  const styleBtns = el('div', { class: 'ae-styles' }, Object.entries(CAPTION_STYLES).map(([k, v]) => {
    const b = el('button', { class: opts.captionStyle === k ? 'on' : '', title: v.note, text: v.label });
    b.addEventListener('click', () => { opts.captionStyle = k; saveOpts(opts); styleBtns.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); });
    return b;
  }));

  const sens = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: opts.sensitivity });
  sens.addEventListener('input', () => { opts.sensitivity = Number(sens.value); saveOpts(opts); });
  const subBtn = el('button', { text: 'Use a subtitle file (.srt) instead…', onclick: async () => {
    const f = await window.hh.openSubtitles(); if (!f) return;
    subtitles = f.text; subtitleName = f.name; renderModel();
  } });
  const radios = el('div', { class: 'ae-radios' }, [['fill', 'Fill 9:16 (crop)'], ['blurfit', 'Blurred background'], ['none', 'Leave as is']].map(([v, t]) => {
    const i = el('input', { type: 'radio', name: 'ae-reframe', value: v, checked: opts.reframe === v });
    i.addEventListener('change', () => { opts.reframe = v; saveOpts(opts); });
    return el('label', { class: 'chk' }, i, t);
  }));

  // ---- run / progress
  const steps = el('div', { class: 'ae-steps' });
  const log = el('div', { class: 'hint' });
  const STEP_LABELS = { audio: 'Read the audio', transcribe: 'Transcribe speech', plan: 'Plan the edit', apply: 'Cut, caption, frame' };
  const setStep = (key, text) => {
    let n = steps.querySelector(`[data-k="${key}"]`);
    if (!n) { n = el('div', { 'data-k': key, class: 'ae-step' }); steps.append(n); }
    steps.querySelectorAll('.ae-step:not(.done)').forEach((x) => { if (x !== n) { x.classList.add('done'); x.textContent = `✔ ${STEP_LABELS[x.dataset.k] || x.dataset.k}`; } });
    n.textContent = `… ${text || STEP_LABELS[key]}`;
  };
  const result = el('div');
  const run = el('button', { class: 'primary', id: 'ae-run', text: 'Run Auto-Edit' });
  const cancel = el('button', { text: 'Cancel', hidden: true });
  const close = el('button', { text: 'Close', onclick: () => { if (!busy) { open = false; root.replaceChildren(); } } });

  run.onclick = async () => {
    busy = true; signal = { aborted: false };
    run.disabled = true; close.disabled = true; cancel.hidden = false; steps.replaceChildren(); result.replaceChildren(); log.textContent = '';
    try {
      const r = await runAutoEdit({ opts, subtitles, signal, onStep: (k, t) => { if (k === 'done') return; setStep(k, t); } });
      steps.querySelectorAll('.ae-step').forEach((x) => { x.classList.add('done'); x.textContent = `✔ ${STEP_LABELS[x.dataset.k] || x.dataset.k}`; });
      result.append(el('div', { class: 'okbox' },
        `✔ Done in one undoable step\n${fmtTime(r.before)} → ${fmtTime(r.after)} (${r.removed.toFixed(1)}s of silence/fillers removed) · ${r.cuts} clips · ${r.words} words · ${r.captions} captions`),
        el('div', { class: 'ae-actions' },
          el('button', { class: 'primary', text: 'Export for TikTok…', onclick: () => { open = false; root.replaceChildren(); openExportDialog({ preset: 'tiktok' }); } }),
          el('button', { text: 'Export captions (.srt)', onclick: async () => {
            const cards = store.transcript?.cards || [];
            const f = await window.hh.saveSubtitles(serializeSrt(cards.map((c) => ({ start: c.start, end: c.end, text: c.text.replace(/\n/g, ' ') }))), store.project.name || 'captions');
            if (f) toast(`Saved ${f}`);
          } }),
          el('button', { text: 'Undo everything', onclick: () => { store.undo(); result.replaceChildren(el('div', { class: 'hint', text: 'Undone — the project is back to how it was.' })); } })));
    } catch (e) {
      steps.querySelectorAll('.ae-step:not(.done)').forEach((x) => { x.textContent = `✖ ${STEP_LABELS[x.dataset.k] || x.dataset.k}`; });
      result.append(el('div', { class: 'errbox', text: e.code === 'NO_MODEL' ? `${e.message}\nDownload it above (one time, runs offline afterwards), or use a subtitle file instead.` : e.message }));
    } finally {
      busy = false; run.disabled = false; close.disabled = false; cancel.hidden = true; signal = null;
      status = await window.hh.asrStatus().catch(() => status); renderModel();
    }
  };
  cancel.onclick = async () => { if (signal) signal.aborted = true; await window.hh.asrCancel(); log.textContent = 'Cancelling…'; };

  const modelSel = select('model', Object.fromEntries(Object.entries(status?.models || {}).map(([k, m]) => [k, `${m.label}${m.installed ? ' ✔' : ` · ${m.approxMB} MB`}`])), renderModel);
  const body = el('div', { class: 'modal ae-modal' },
    el('h3', { text: 'TIKTOK AUTO-EDIT  ·  ตัดต่อ TikTok อัตโนมัติ' }),
    el('div', { class: 'hint' }, clip ? `Editing: ${clip.name || media?.name} · ${fmtTime(clip.duration)}` : el('span', { class: 'warn', text: 'No clip with audio found — import a video with speech and select it on the timeline.' })),
    el('section', { class: 'ae-sec' }, el('h4', { text: 'Speech · เสียงพูด' }),
      row('Language', select('language', { th: 'ไทย (Thai)', en: 'English', auto: 'Auto-detect' })),
      row('Model', modelSel), modelBox, dlBar, subBtn),
    el('section', { class: 'ae-sec' }, el('h4', { text: 'Edit · การตัดต่อ' }),
      check('cutSilence', 'Cut silences · ตัดช่วงเงียบ', 'Jump-cut every pause longer than ~0.35 s'),
      row('Sensitivity', sens),
      check('removeFillers', 'Remove fillers · ตัด เอ่อ / อืม / อ่า', 'Cuts hesitation sounds the transcript recognised'),
      check('punch', 'Punch-in on every other cut · ซูมสลับ', 'Hides jump cuts the way TikTok editors do'),
      row('Frame', radios), check('setCanvas', 'Set project to 9:16 (1080×1920)'),
      row('Look', select('look', Object.fromEntries(Object.entries(LOOKS).map(([k, v]) => [k, v.label])))),
      check('normalize', 'Normalise loudness to −14 LUFS (TikTok/Reels level)')),
    el('section', { class: 'ae-sec' }, el('h4', { text: 'Captions · แคปชั่น' }),
      check('captions', 'Thai word-by-word captions · แคปชั่นไทยไฮไลต์ตามคำ'), styleBtns),
    steps, log, result,
    el('div', { class: 'actions' }, cancel, close, run));
  renderModel();
  open = true;
  root.replaceChildren(el('div', { class: 'modal-back' }, body));
}
