// The PREVIEW bar over the monitor. While a "what if" is showing (store.showGhost), the monitor draws it instead of the real project:
// press Space to play it, judge it, then Apply (one Undo step) or Cancel (nothing happened). Nothing is applied by looking.
import { store } from '../store.js';
import { el, toast } from './dom.js';

export function mountGhostBar() {
  const wrap = document.getElementById('preview-wrap');
  if (!wrap) return;
  const label = el('b', { class: 'ghost-label' });
  const bar = el('div', { id: 'ghost-bar', class: 'ghost-bar', hidden: true, role: 'status' },
    el('span', { class: 'ghost-tag', text: 'PREVIEW' }), label, el('span', { class: 'ghost-hint', text: 'not applied yet · Space plays it' }),
    el('button', { id: 'ghost-apply', class: 'primary', text: 'APPLY', onclick: () => { const r = store.commitGhost(); if (r) toast(typeof r === 'string' ? r : 'Applied. Undo takes it back.'); else toast('That no longer applies.', 'error'); } }),
    el('button', { id: 'ghost-cancel', text: 'CANCEL', onclick: () => store.clearGhost() }));
  wrap.append(bar);
  const render = () => { const g = store.ghostSpec; bar.hidden = !g; label.textContent = g?.label || ''; };
  store.on('ghost', render);
  render();
  // Esc leaves the preview (but only when nothing else owns Esc: a Take or Trace does)
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && store.ghost && !store.recorder) { store.clearGhost(); } });
}
