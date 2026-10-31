// The one place a suggestion can appear: a small note at the bottom of the window. It never takes focus, never covers the controls, and
// goes away by itself. It exists only when the Decision Gate (shared/creative/gate.js) let something through, which is rare.
import { store } from '../store.js';
import { el, toast } from './dom.js';
import { creative } from '../creative/engine.js';

export function mountSuggestionChip() {
  const root = el('div', { id: 'creative-chip', class: 'cchip', hidden: true, role: 'status', 'aria-live': 'polite' });
  document.body.append(root);
  const done = (r) => toast(r.ok ? `${r.text || 'Done.'} Undo takes it back.` : r.reason, r.ok ? 'info' : 'error');
  function render() {
    const s = creative.suggestion;
    if (!s) { root.hidden = true; root.replaceChildren(); return; }
    const acts = s.kind === 'relate'
      ? [el('button', { class: 'primary', 'data-act': 'apply', text: 'APPLY', onclick: () => done(creative.applySuggestion()) })]
      : s.items.map((it) => el('button', { 'data-act': 'bring', 'data-id': it.id, text: `BRING BACK · ${it.name}`.slice(0, 34), title: `Bring back ${it.name}`, onclick: () => done(creative.applySuggestion(it.id)) }));
    root.replaceChildren(el('b', { class: 'cchip-h', text: s.heading }), el('span', { class: 'cchip-l', text: s.line }),
      el('div', { class: 'cchip-a' }, ...acts, el('button', { 'data-act': 'dismiss', text: 'DISMISS', onclick: () => creative.dismissSuggestion() })));
    root.hidden = false;
  }
  store.on('suggestion', render);
  setInterval(() => creative.revalidate(), 500); // playing, typing or moving on takes it away quietly
  render();
}
