import { el } from './dom.js';
import { store } from '../store.js';
import { RESOLUTIONS } from '/shared/project.js';

export function mountProjectSettings(root) {
  const render = () => {
    const s = store.project.settings;
    root.replaceChildren();
    const cur = Object.entries(RESOLUTIONS).find(([, r]) => r.width === s.width && r.height === s.height)?.[0] || 'custom';
    const res = el('select', {}, [...Object.entries(RESOLUTIONS).map(([k, r]) => el('option', { value: k, text: `${k} (${r.width}×${r.height})`, ...(k === cur ? { selected: true } : {}) })),
      cur === 'custom' ? el('option', { value: 'custom', text: `custom (${s.width}×${s.height})`, selected: true }) : null]);
    res.addEventListener('change', () => { const r = RESOLUTIONS[res.value]; if (r) store.mutate((p) => { p.settings.width = r.width; p.settings.height = r.height; }); });
    const fps = el('select', {}, [24, 25, 30, 50, 60].map((f) => el('option', { value: f, text: f, ...(f === s.fps ? { selected: true } : {}) })));
    fps.addEventListener('change', () => store.mutate((p) => { p.settings.fps = Number(fps.value); }));
    root.append(el('section', { class: 'card' }, el('h4', { text: 'Project settings' }), el('div', { class: 'body' },
      el('div', { class: 'row flat' }, el('label', { text: 'Canvas' }), res), el('div', { class: 'row flat' }, el('label', { text: 'Frame rate' }), fps),
      el('p', { class: 'hint', text: 'The first video imported into an empty project sets these automatically.' }))));
    const kb = (keys, what) => el('div', { class: 'kb' }, el('span', { class: 'keys' }, ...keys.map((k) => el('kbd', { text: k }))), el('span', { text: what }));
    root.append(el('section', { class: 'card' }, el('h4', { text: 'Keyboard' }), el('div', { class: 'body' },
      kb(['Space'], 'play / pause'), kb(['S'], 'split at playhead'), kb(['Delete'], 'remove clip'), kb(['⇧', 'Delete'], 'remove and close the gap'),
      kb(['←', '→'], 'step one frame'), kb(['+', '−'], 'timeline zoom'), kb(['Ctrl/Cmd', 'Z'], 'undo'), kb(['Ctrl/Cmd', '⇧', 'Z'], 'redo'))));
  };
  store.on('project', () => { if (!root.contains(document.activeElement)) render(); });
  store.on('reset', render);
  render();
}
