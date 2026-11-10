// "Usage notes" card (Project tab). Off by default. Shows what is kept and lets the artist look at the whole report, save it to a file, or clear it.
import { el } from './dom.js';
import { diag } from '../diag.js';

let card = null; // one card, moved between renders of the Project tab so its state is never rebuilt under the artist's hands

export function diagCard() {
  if (card) return card;
  const on = el('input', { type: 'checkbox', id: 'diag-on', checked: diag.enabled });
  const sum = el('p', { class: 'hint', id: 'diag-sum' }), status = el('p', { class: 'hint', id: 'diag-status' });
  const pre = el('pre', { class: 'diag-pre', id: 'diag-pre' });
  const view = el('details', { class: 'liv-adv', id: 'diag-view' }, el('summary', { text: 'Show exactly what would be saved' }), pre);
  const save = el('button', { id: 'diag-save', class: 'primary', text: 'Save report…', title: 'Choose where to save a small file you can send back', onclick: async () => {
    try { const r = diag.report(); const f = await window.hh.saveJson(JSON.stringify(r, null, 2), `hhlab-usage-notes-${new Date().toISOString().slice(0, 10)}`); status.textContent = f ? `Saved. Nothing was sent anywhere: the file is yours to send.` : 'Not saved.'; }
    catch (e) { status.textContent = `Could not save: ${e.message}`; } } });
  const clear = el('button', { id: 'diag-clear', text: 'Clear', title: 'Erase everything noted so far', onclick: () => { diag.clear(); status.textContent = 'Cleared.'; } });
  card = el('section', { class: 'card', id: 'diag-card' }, el('h4', { text: 'Usage notes' }), el('div', { class: 'body' },
    el('p', { class: 'hint', text: 'Off by default. When on, the editor keeps a few numbers on this computer only: how smoothly playback ran, what exports took, how often each feature was used, and error messages. Never pictures, your project, names, text you typed or said, files, your API key, or what you asked the AI. It is sent nowhere. If you want to share it, save the report to a file and send that.' }),
    el('label', { class: 'chk' }, on, 'Keep usage notes on this computer'), sum, el('div', { class: 'cmd-row' }, save, clear), status, view));
  on.addEventListener('change', async () => { await diag.setEnabled(on.checked); status.textContent = on.checked ? 'On. Play and edit as usual; come back here to save the report.' : 'Off. What was noted stays until you press Clear.'; });
  const refresh = () => {
    on.checked = diag.enabled;
    const s = diag.summary(), since = s.since ? new Date(s.since).toLocaleDateString() : '';
    sum.textContent = diag.enabled || s.frames || s.uses || s.exports ? `${s.frames.toLocaleString()} frames played, ${s.exports} export${s.exports === 1 ? '' : 's'}, ${s.uses} feature uses, ${s.errors} kind${s.errors === 1 ? '' : 's'} of error${since ? `, since ${since}` : ''}.${diag.enabled ? '' : ' (off)'}` : 'Nothing noted yet.';
    pre.textContent = view.open ? JSON.stringify(diag.report(), null, 1) : '';
  };
  view.addEventListener('toggle', refresh);
  diag.listeners.add(refresh); refresh(); setInterval(() => { if (document.getElementById('project-settings')?.classList.contains('on')) refresh(); }, 3000);
  return card;
}
