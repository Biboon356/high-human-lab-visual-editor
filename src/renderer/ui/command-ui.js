// "Tell it" box (Audio-Reactive tab): type a sentence, see what was understood, PREVIEW it in the monitor, then Apply (one Undo step) or Cancel.
// Nothing is applied by typing. When the sentence is not understood it says so and changes nothing.
import { store } from '../store.js';
import { el } from './dom.js';
import { parseCommand } from '/shared/command/parse.js';
import { dictationPrompt } from '/shared/command/dictation.js';
import { EFFECTS } from '/shared/effects-defs.js';
import { attachDictation } from './dictation-button.js';

export function mountCommand(root, { runAnalysis, preview }) {
  const api = { dictate: (o) => window.hh.asrDictate(o) }; // a seam: window.hh is frozen by the preload bridge, so the e2e swaps this instead
  const input = el('input', { type: 'text', id: 'cmd-input', class: 'cmd-input', placeholder: 'e.g. glitch react to bass · ให้ grain ตามความดัง · กระตุกตามเบสแรงๆ', autocomplete: 'off', spellcheck: 'false' });
  const status = el('p', { class: 'hint', id: 'cmd-status' });
  const list = el('ul', { class: 'cmd-list', id: 'cmd-list' });
  const go = el('button', { id: 'cmd-go', class: 'primary', text: 'Show me', onclick: submit });
  const mic = el('button', { id: 'cmd-mic', class: 'cmd-mic', text: '🎙 Hold to speak', title: 'Hold the button (or Space while it is focused), say it, let go. The words appear in the box for you to check and fix; nothing runs until you press Show me. Recognised on this computer: no sound leaves it.' });
  const lang = el('select', { id: 'cmd-lang', title: 'The language you speak in' }, el('option', { value: 'th', text: 'ไทย' }), el('option', { value: 'en', text: 'English' }));
  const pauseChk = el('input', { type: 'checkbox', id: 'cmd-pause', checked: true });
  root.append(el('section', { class: 'card', id: 'cmd-card' }, el('h4', { text: 'Tell it' }),
    el('div', { class: 'body' },
      el('p', { class: 'hint', text: 'Say which effect or property should follow which sound (bass, mids, highs, beats, loudness) on the selected clips. You see what I understood and a preview first; nothing changes until you press Apply.' }),
      el('div', { class: 'cmd-row' }, input, go), el('div', { class: 'cmd-row' }, mic, lang, el('label', { class: 'chk', title: 'The microphone also hears the song. Playback is paused while you hold the button and resumed after.' }, pauseChk, 'Pause playback while I speak')), status, list)));
  try { lang.value = localStorage.getItem('hhlab.cmd.lang') || 'th'; } catch { /* storage unavailable */ }
  lang.addEventListener('change', () => { try { localStorage.setItem('hhlab.cmd.lang', lang.value); } catch { /* storage unavailable */ } });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

  // ---- speak ---- (the shared hold-to-speak button: the words land in the box, nothing runs)
  attachDictation({ mic, input, setStatus: (t) => { status.textContent = t; }, getLang: () => lang.value, pauseChk, preview, dictate: (o) => api.dictate(o),
    prompt: () => dictationPrompt(Object.values(EFFECTS).map((e) => e.label.replace(/ \(.*/, ''))), doneText: 'Is that what you said? Fix any word, then press Show me. Nothing has changed yet.' });

  function show(lines, cls = '') { list.replaceChildren(...lines.map((t) => el('li', { class: cls, text: t }))); }

  async function submit() {
    store.clearGhost();
    const clipIds = [...store.multi];
    const r = parseCommand(input.value, store.project, { clipIds, hasAnalysis: !!store.analysis && !store.analysisStale });
    if (!r.ok) { status.textContent = r.reason; show([]); return; }
    show([...r.understood.map((t) => `✓ ${t}`), ...r.notes.map((t) => `• ${t}`)]);
    if (r.intent === 'bind' && (!store.analysis || store.analysisStale)) { status.textContent = 'Analyzing the audio first…'; await runAnalysis({ quiet: true }); }
    const ok = store.showGhost({ label: `Tell it · ${r.understood[0]}${r.understood.length > 1 ? ` +${r.understood.length - 1}` : ''}`, apply: (p) => r.apply(p), done: 'Done. Undo takes it back.' });
    status.textContent = ok ? 'Previewing: press Space to play it. Apply keeps it, Cancel forgets it.' : 'Nothing to change (already like that, or no clip to work on).';
    if (ok && !store.analysis) status.textContent += ' (There is no audio in the project, so nothing will move yet.)';
  }
  return api;
}
