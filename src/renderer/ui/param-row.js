// One animatable parameter: slider + number + keyframe toggle + audio-reactive binding.
import { el } from './dom.js';
import { store } from '../store.js';
import { evalTrack, keyAt, setKey, removeKey } from '/shared/keyframes.js';
import { REACTIVE_SOURCES } from '/shared/params.js';

export const rowUpdaters = new Set(); // refreshed on playhead moves so keyframed values follow time

/**
 * @param o {owner, def, getBase, setBase, localTime:()=>number, onReactiveRequested?}
 *   owner: object with keyframes{} and bindings{}
 */
export function paramRow({ owner, def, getBase, setBase, localTime }) {
  const { key, label, min, max, step } = def;
  // Non-animatable kinds: enumerations and colours are plain static values.
  if (def.options || def.kind === 'color') {
    const ctl = def.options
      ? el('select', {}, def.options.map((o, i) => el('option', { value: i, text: o, ...(i === Number(getBase()) ? { selected: true } : {}) })))
      : el('input', { type: 'color', value: getBase() });
    let snapped = false;
    ctl.addEventListener('input', () => { if (!snapped) { store.snapshot(); snapped = true; } setBase(def.options ? Number(ctl.value) : ctl.value); store.touch('render'); });
    ctl.addEventListener('change', () => { snapped = false; });
    return el('div', { class: 'row flat' }, el('label', { text: label, title: label }), el('div', { class: 'inline' }, ctl));
  }
  const slider = el('input', { type: 'range', min, max, step });
  const num = el('input', { type: 'number', min, max, step });
  const kf = el('button', { class: 'kf', title: 'Keyframe at playhead (click again to remove, Shift-click clears all)', text: '◆' });
  const rx = el('button', { class: 'rx', title: 'Audio-reactive binding', text: '∿' });
  const row = el('div', { class: 'row' }, el('label', { text: label, title: label }), slider, num, kf, rx);
  const reactRow = el('div', { class: 'react-row' });
  reactRow.hidden = true;
  const wrap = el('div', {}, row, reactRow);

  const hasKeys = () => (owner.keyframes?.[key] || []).length > 0;
  const current = () => evalTrack(owner.keyframes?.[key], localTime(), getBase());
  const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''));

  const refresh = () => {
    const v = current();
    slider.value = v;
    if (document.activeElement !== num) num.value = fmt(v);
    const here = keyAt(owner.keyframes?.[key], localTime()) >= 0;
    kf.classList.toggle('has', hasKeys());
    kf.textContent = here ? '◆' : hasKeys() ? '◈' : '◇';
    rx.classList.toggle('has', !!owner.bindings?.[key]);
  };

  let gesture = false;
  const apply = (v) => {
    v = Math.min(max, Math.max(min, v));
    if (!gesture) { store.snapshot(); gesture = true; }
    if (hasKeys()) owner.keyframes[key] = setKey(owner.keyframes[key], localTime(), v); // auto-key
    else setBase(v);
    refresh();
    store.touch('render');
  };
  slider.addEventListener('input', () => apply(Number(slider.value)));
  slider.addEventListener('change', () => { gesture = false; store.emit('keyframes'); });
  num.addEventListener('change', () => { apply(Number(num.value)); gesture = false; });

  kf.addEventListener('click', (e) => {
    store.snapshot();
    owner.keyframes ||= {};
    const t = localTime();
    if (e.shiftKey) delete owner.keyframes[key];
    else if (keyAt(owner.keyframes[key], t) >= 0) {
      const v = current();
      owner.keyframes[key] = removeKey(owner.keyframes[key], t);
      if (!owner.keyframes[key].length) { delete owner.keyframes[key]; setBase(v); }
    } else owner.keyframes[key] = setKey(owner.keyframes[key], t, current());
    store.touch('render', 'keyframes');
    refresh();
  });

  const buildReact = () => {
    reactRow.replaceChildren();
    const b = owner.bindings?.[key];
    if (!b) { reactRow.hidden = true; return; }
    reactRow.hidden = false;
    const sel = el('select', {}, REACTIVE_SOURCES.map((s) => el('option', { value: s, text: s, ...(s === b.source ? { selected: true } : {}) })));
    const amt = el('input', { type: 'range', min: -1, max: 1, step: 0.01, value: b.amount });
    const out = el('span', { text: b.amount.toFixed(2) });
    sel.addEventListener('change', () => { store.snapshot(); b.source = sel.value; store.touch('render'); });
    amt.addEventListener('input', () => { b.amount = Number(amt.value); out.textContent = b.amount.toFixed(2); store.touch('render'); });
    amt.addEventListener('pointerdown', () => store.snapshot());
    reactRow.append(el('span', { text: '↳ reacts to' }), sel, amt, out);
  };
  rx.addEventListener('click', () => {
    store.snapshot();
    owner.bindings ||= {};
    if (owner.bindings[key]) delete owner.bindings[key];
    else {
      owner.bindings[key] = { source: 'bass', amount: 0.5 };
      store.emit('need-analysis');
    }
    buildReact(); refresh(); store.touch('render');
  });

  buildReact();
  refresh();
  const updater = () => { if (!wrap.isConnected) { rowUpdaters.delete(updater); return; } if (hasKeys()) refresh(); };
  rowUpdaters.add(updater);
  return wrap;
}

export function flatRow(label, ...controls) {
  return el('div', { class: 'row flat' }, el('label', { text: label, title: label }), el('div', { class: 'inline' }, controls));
}
