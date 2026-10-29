// Presets tab: search + category chips over the preset library. A preset goes onto the selected clip (its effects are appended)
// or becomes an adjustment layer that grades everything beneath it. Both are one undo step.
import { el, toast } from './dom.js';
import { store } from '../store.js';
import { PRESET_LIBRARY, PRESET_CATEGORIES, searchPresets } from '/shared/preset-library.js';
import { instantiatePreset } from '/shared/effects-defs.js';
import { findMedia } from '/shared/project.js';
import { addAdjustLayer } from './media-bin.js';

const targetClip = () => {
  const c = store.selectedClip;
  if (!c || c.type === 'adjust') return c?.type === 'adjust' ? c : null;
  const media = c.type === 'media' ? findMedia(store.project, c.mediaId) : null;
  return media?.kind === 'audio' ? null : c;
};

/** Appends the preset's effects to a clip. Returns the clip, or null when nothing suitable is selected. */
export function applyPresetToClip(preset) {
  const clip = targetClip();
  if (!clip) return null;
  store.mutate(() => { clip.effects.push(...instantiatePreset(preset)); });
  return clip;
}

export function mountPresetLibrary() {
  const search = document.getElementById('preset-search');
  const cats = document.getElementById('preset-cats');
  const list = document.getElementById('preset-list');
  const count = document.getElementById('preset-count');
  let category = 'All';

  const chip = (name) => {
    const b = el('button', { class: `chip ${name === category ? 'on' : ''}`, 'data-cat': name, role: 'tab', 'aria-selected': String(name === category), text: name === 'All' ? `All ${PRESET_LIBRARY.length}` : `${name} ${PRESET_LIBRARY.filter((p) => p.category === name).length}` });
    b.addEventListener('click', () => { category = name; renderChips(); renderList(); });
    return b;
  };
  const renderChips = () => cats.replaceChildren(...['All', ...PRESET_CATEGORIES].map(chip));

  const renderList = () => {
    const found = searchPresets(search.value, category);
    count.textContent = `${found.length} of ${PRESET_LIBRARY.length}`;
    list.replaceChildren(...(found.length ? found.map((p) => {
      const onClip = el('button', { class: 'p-clip', 'data-preset': p.id, title: `Add "${p.name}" to the selected clip: ${p.chain.map((e) => e.type).join(' → ')}`, onclick: () => {
        if (p.fade) { addAdjustLayer(p); toast(`"${p.name}" placed at the ${p.fade === 'out' ? 'end' : 'start'} of the cut.`); return; } // fades are always a layer
        const c = applyPresetToClip(p);
        if (!c) { addAdjustLayer(p); toast(`No clip selected — "${p.name}" added as an adjustment layer.`); } else toast(`"${p.name}" added to ${c.name || 'the clip'}.`);
      } }, el('span', { class: 'pn', text: p.name }), el('small', { text: `${p.note || p.category} · ${p.chain.length} fx` }));
      const layer = el('button', { class: 'p-layer', title: 'Apply as an adjustment layer over everything below', 'data-layer': p.id, text: 'Layer', onclick: () => addAdjustLayer(p) });
      return el('div', { class: 'preset-row' }, onClip, layer);
    }) : [el('div', { class: 'empty', text: 'Nothing matches. Try a shorter word, or "All".' })]));
  };
  search.addEventListener('input', renderList);
  renderChips(); renderList();
}
