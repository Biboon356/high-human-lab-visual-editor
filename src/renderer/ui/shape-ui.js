// Inspector card for shape clips (see shared/shape-defs.js).
import { el } from './dom.js';
import { store } from '../store.js';
import { flatRow } from './param-row.js';
import { SHAPES, SHAPE_KINDS, normalizeShape } from '/shared/shape-defs.js';

function field(input, event, apply) {
  let snapped = false;
  input.addEventListener(event, () => { if (!snapped) { store.snapshot(); snapped = true; } apply(input); store.touch('render'); });
  input.addEventListener('change', () => { snapped = false; });
  return input;
}

export function shapeCard(clip, card) {
  clip.shape = normalizeShape(clip.shape);
  const S = clip.shape, d = SHAPES[S.kind] || {};
  const range = (min, max, step, key, label, onApply) => flatRow(label, field(el('input', { type: 'range', min, max, step, value: S[key] ?? 0 }), 'input', (i) => { S[key] = Number(i.value); onApply?.(); }));
  const kind = el('select', { 'data-shape-kind': '1' }, SHAPE_KINDS.map((k) => el('option', { value: k, text: SHAPES[k].label, ...(k === S.kind ? { selected: true } : {}) })));
  kind.addEventListener('change', () => { store.mutate(() => { const keep = { color: S.color }; Object.assign(S, normalizeShape({ kind: kind.value, ...keep })); clip.name = SHAPES[kind.value].label; }); });
  const rows = [flatRow('Shape', kind)];
  if (d.uniform) rows.push(range(0.03, 1.2, 0.005, 'size', 'Size'));
  else { rows.push(range(0.01, 1.2, 0.005, 'w', 'Width')); rows.push(range(0.002, 1.2, 0.002, 'h', 'Height')); }
  const fillBox = field(el('input', { type: 'checkbox', checked: !!S.fill }), 'change', (i) => { S.fill = i.checked; });
  const col = field(el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(S.color) ? S.color : '#ffffff' }), 'input', (i) => { S.color = i.value; if (!S.strokeColor || S.strokeColor === S.color) S.strokeColor = i.value; });
  const col2 = field(el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(S.color2 || '') ? S.color2 : '#ffffff' }), 'input', (i) => { S.color2 = i.value; });
  const grad = field(el('input', { type: 'checkbox', checked: !!S.gradient }), 'change', (i) => { S.gradient = i.checked; });
  rows.push(flatRow('Colour', col, el('label', { class: 'chk' }, fillBox, 'filled')), flatRow('Second colour', col2, el('label', { class: 'chk', title: 'Top-to-bottom gradient (some shapes use it as their inner colour)' }, grad, 'gradient')));
  rows.push(range(0, 0.03, 0.0005, 'stroke', 'Outline'));
  if (['star', 'sun', 'lotus', 'rosette', 'dotrow', 'stripes', 'retrosun'].includes(S.kind)) rows.push(range(1, 48, 1, 'n', S.kind === 'star' ? 'Points' : S.kind === 'lotus' ? 'Petals' : 'Count'));
  if (['star', 'sun', 'lotus', 'rect', 'arch', 'frame'].includes(S.kind)) rows.push(range(0, 1, 0.01, 'ratio', S.kind === 'star' ? 'Sharpness' : S.kind === 'rect' ? 'Corner radius' : 'Shape'));
  rows.push(range(0, 1, 0.01, 'glow', 'Glow'), range(0, 1, 0.01, 'shadow', 'Shadow'), range(-90, 90, 1, 'spin', 'Spin (deg/s)'));
  return card('Shape', rows);
}
