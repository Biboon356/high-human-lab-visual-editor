// In-app updates, renderer side: a top-bar button when an update is ready (restart to apply) or needs a new installer,
// and an "Updates" card in the Project pane with the current version and a manual check.
import { el, toast } from './dom.js';
import { store } from '../store.js';

const hh = window.hh;
let state = { state: 'idle', version: '', installed: '', next: null, checking: false, error: null };
const listeners = new Set();

const label = (s) => {
  if (s.checking) return 'Checking…';
  if (s.state === 'ready') return `Version ${s.next} is downloaded — restart to use it.`;
  if (s.state === 'needs-installer') return `Version ${s.next} needs a new installer (it changes parts of the app that cannot be updated in place).`;
  if (s.error) return `Could not check (${s.error}). Are you online?`;
  if (s.state === 'uptodate') return 'You are up to date.';
  return 'Updates are checked automatically in the background.';
};

export function mountUpdateButton() {
  const btn = document.getElementById('btn-update');
  const render = () => {
    const show = state.state === 'ready' || state.state === 'needs-installer';
    btn.hidden = !show;
    if (!show) return;
    btn.textContent = state.state === 'ready' ? `Update ${state.next} · Restart` : `New installer ${state.next}`;
    btn.dataset.tip = label(state);
    btn.setAttribute('aria-label', label(state));
  };
  btn.onclick = () => {
    if (state.state === 'ready') {
      const unsaved = store.dirty ? '\n\nYour unsaved changes are kept: the app saves a recovery copy and offers it when it reopens.' : '';
      if (confirm(`Restart now to use version ${state.next}?${unsaved}`)) hh.updateApply();
    } else if (state.state === 'needs-installer') hh.updateOpenRelease();
  };
  const apply = (s) => { state = s; render(); listeners.forEach((f) => f(s)); };
  hh.updateStatus().then(apply).catch(() => {});
  hh.onUpdate(apply);
}

export async function checkNow() {
  const s = await hh.updateCheck();
  if (s.state === 'ready') toast(`Version ${s.next} is downloaded. Press “Update ${s.next} · Restart” in the top bar when you are ready.`);
  else if (s.state === 'needs-installer') toast(`Version ${s.next} is out, but it needs a new installer. Use the button in the top bar to open the download page.`);
  else if (s.error) toast(`Could not check for updates: ${s.error}`, 'error');
  else toast('You are up to date.');
  return s;
}

let card = null;
/** One persistent card node (the Project pane re-renders often; this keeps its state and subscription). */
export function updateCard() {
  if (card) return card;
  const info = el('div', { class: 'stat' }), status = el('div', { class: 'hint' });
  const check = el('button', { id: 'btn-check-updates', text: 'Check for updates', onclick: () => checkNow() });
  const paint = async (s = state) => {
    let app = null; try { app = await hh.appInfo(); } catch { /* old shell */ }
    const v = app?.version || s.version;
    info.replaceChildren('Version ', el('b', { text: v || '—' }), app?.updated ? ` · updated in place (installer ${app.installed})` : '');
    status.textContent = label(s);
    check.disabled = !!s.checking;
  };
  listeners.add(paint); paint();
  card = el('section', { class: 'card', id: 'update-card' }, el('h4', { text: 'Updates' }), el('div', { class: 'body' }, info, status, el('div', { class: 'ae-actions' }, check)));
  return card;
}
