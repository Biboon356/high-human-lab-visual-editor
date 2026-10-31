// Mask + matte controls: the Inspector cards, and the on-picture editor (drag shapes and their points, draw a polygon).
import { el } from './dom.js';
import { store } from '../store.js';
import { paramRow, flatRow } from './param-row.js';
import { resolveClipProps } from '/shared/params.js';
import {
  MASK_PROPS, MAX_POINTS, createShape, maskTransform, applyTransform, inverseTransform, moveShape, nearestEdge, canBeMatte, MATTE_USES,
} from '/shared/mask.js';

export const maskEdit = { on: false, drawing: null, sel: 0 }; // drawing: null | [[u,v],…] while the polygon tool is active
const KIND_LABEL = { rect: 'Rectangle', ellipse: 'Ellipse', poly: 'Polygon' };

const notify = () => store.emit('maskedit');

/** Adds a shape to the selected clip's mask (creating the mask on first use). */
export function addMaskShape(clip, shape) {
  store.mutate(() => {
    if (!clip.mask || !Array.isArray(clip.mask.shapes)) clip.mask = { shapes: [], invert: false };
    clip.mask.shapes.push(shape);
    maskEdit.sel = clip.mask.shapes.length - 1;
    maskEdit.on = true;
  });
  notify();
}

export function maskCard(clip, lt, card) {
  const m = clip.mask && Array.isArray(clip.mask.shapes) ? clip.mask : null;
  const body = [];
  const add = (kind) => addMaskShape(clip, createShape(kind));
  const addRow = el('div', { class: 'fx-toolbar' },
    el('button', { text: '+ Rectangle', 'data-mask-add': 'rect', onclick: () => add('rect') }),
    el('button', { text: '+ Ellipse', 'data-mask-add': 'ellipse', onclick: () => add('ellipse') }),
    el('button', { text: '+ Draw…', 'data-mask-add': 'poly', title: 'Click points on the picture to outline an area; click the first point or press Enter to close it', onclick: () => { maskEdit.drawing = []; maskEdit.on = true; notify(); } }));
  body.push(addRow);
  if (!m) body.push(el('div', { class: 'hint', text: 'A mask shows the clip only inside a shape — or, inverted, everywhere except it. On an adjustment layer it limits where the look applies.' }));
  else {
    m.shapes.forEach((s, i) => {
      const cut = el('input', { type: 'checkbox', checked: !!s.sub, title: 'Cut this shape out of the mask instead of adding it' });
      cut.addEventListener('change', () => { store.mutate(() => { s.sub = cut.checked; }); });
      body.push(el('div', { class: `row flat mask-shape${i === maskEdit.sel ? ' on' : ''}`, 'data-shape': i },
        el('label', { text: `${i + 1}. ${KIND_LABEL[s.k] || s.k}`, onclick: () => { maskEdit.sel = i; maskEdit.on = true; notify(); store.touch('project'); } }),
        el('div', { class: 'inline' }, el('label', { class: 'chk' }, cut, 'cut'),
          el('button', { text: '✕', title: 'Remove this shape', onclick: () => { store.mutate(() => { m.shapes.splice(i, 1); if (!m.shapes.length) delete clip.mask; maskEdit.sel = 0; }); notify(); } }))));
    });
    const inv = el('input', { type: 'checkbox', checked: !!m.invert });
    inv.addEventListener('change', () => { store.mutate(() => { m.invert = inv.checked; }, 'render'); });
    const edit = el('input', { type: 'checkbox', checked: maskEdit.on });
    edit.addEventListener('change', () => { maskEdit.on = edit.checked; notify(); });
    body.push(flatRow('Invert', el('label', { class: 'chk' }, inv, 'show everything outside')), flatRow('Edit', el('label', { class: 'chk' }, edit, 'shapes in the preview')));
    for (const d of MASK_PROPS) body.push(paramRow({ owner: clip, def: d, getBase: () => clip.props[d.key], setBase: (v) => { clip.props[d.key] = v; }, localTime: lt }));
    body.push(el('div', { class: 'fx-toolbar' }, el('button', { text: 'Remove mask', 'data-mask-clear': '1', onclick: () => { store.mutate(() => { delete clip.mask; }); maskEdit.on = false; notify(); } })));
  }
  return card('Mask', body);
}

export function matteCard(clip, card) {
  const others = store.project.clips.filter((c) => canBeMatte(store.project, clip, c.id));
  const cur = clip.matte?.source || '';
  const sel = el('select', { 'data-matte-source': '1' }, el('option', { value: '', text: 'None' }),
    others.map((c) => el('option', { value: c.id, text: `${c.name || c.type} · ${c.start.toFixed(1)}s`, ...(c.id === cur ? { selected: true } : {}) })));
  sel.addEventListener('change', () => {
    store.mutate(() => { if (!sel.value) delete clip.matte; else clip.matte = { source: sel.value, use: clip.matte?.use || 'alpha', invert: !!clip.matte?.invert }; });
  });
  const body = [flatRow('Picture from', sel)];
  if (clip.matte) {
    const use = el('select', { 'data-matte-use': '1' }, MATTE_USES.map((u) => el('option', { value: u, text: u === 'alpha' ? 'Its shape (alpha)' : 'Its brightness (luma)', ...(u === clip.matte.use ? { selected: true } : {}) })));
    use.addEventListener('change', () => { store.mutate(() => { clip.matte.use = use.value; }, 'render'); });
    const inv = el('input', { type: 'checkbox', checked: !!clip.matte.invert });
    inv.addEventListener('change', () => { store.mutate(() => { clip.matte.invert = inv.checked; }, 'render'); });
    body.push(flatRow('Uses', use), flatRow('Invert', el('label', { class: 'chk' }, inv, 'show where it is empty')),
      el('div', { class: 'hint', text: 'The matte clip is not drawn itself — it only decides what this clip shows (e.g. a title as a window onto footage).' }));
  } else body.push(el('div', { class: 'hint', text: 'Let another clip decide what shows: pick a title or picture and this clip appears only through its letters/shape.' }));
  return card('Matte', body);
}

// ---------- the editor drawn over the preview ----------
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

export function mountMaskEditor({ preview }) {
  const canvas = document.getElementById('preview');
  const wrap = document.getElementById('preview-wrap');
  const ov = svg('svg', { id: 'mask-ov', class: 'mask-ov' });
  wrap.append(ov);
  let cursor = null; // pointer while drawing, canvas px

  const view = () => {
    const r = canvas.getBoundingClientRect(), cw = preview.comp.w, ch = preview.comp.h, w = wrap.getBoundingClientRect();
    const k = Math.min(r.width / cw, r.height / ch);
    return { left: r.left + (r.width - cw * k) / 2, top: r.top + (r.height - ch * k) / 2, k, ox: w.left, oy: w.top };
  };
  const W = () => preview.comp.w, H = () => preview.comp.h;
  const toUv = (e) => { const v = view(); return [(e.clientX - v.left) / v.k / W(), (e.clientY - v.top) / v.k / H()]; };
  const toPx = (uv) => { const v = view(); return [v.left - v.ox + uv[0] * W() * v.k, v.top - v.oy + uv[1] * H() * v.k]; };
  const xfFor = (clip, mask) => maskTransform(mask, resolveClipProps(clip, Math.min(Math.max(0, store.playhead - clip.start), clip.duration), null));
  const fwd = (xf, p) => toPx(applyTransform(xf, p, W(), H()));
  const inv = (xf, e) => inverseTransform(xf, toUv(e), W(), H());

  function gesture(e, onMove) {
    e.stopPropagation(); e.preventDefault();
    let did = false;
    const move = (ev) => { if (!did) { store.snapshot(); did = true; } onMove(ev); store.touch('render'); redraw(); };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (did) { store.touch('project'); } redraw(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  function handle(pos, title, onDown, cls = '') {
    const h = svg('circle', { cx: pos[0], cy: pos[1], r: 5.5, class: `mh ${cls}` });
    const t = svg('title'); t.textContent = title; h.append(t);
    h.addEventListener('pointerdown', onDown);
    ov.append(h);
    return h;
  }

  function redraw() {
    ov.replaceChildren();
    const clip = store.selectedClip;
    const mask = clip?.mask && Array.isArray(clip.mask.shapes) ? clip.mask : null;
    const show = !!clip && maskEdit.on && !store.playing && (mask || maskEdit.drawing);
    ov.style.display = show ? 'block' : 'none';
    if (!show) return;
    const xf = mask ? xfFor(clip, mask) : { pu: 0.5, pv: 0.5, dx: 0, dy: 0, s: 1, rot: 0 };

    if (maskEdit.drawing) {
      const pts = maskEdit.drawing;
      const layer = svg('rect', { x: 0, y: 0, width: '100%', height: '100%', class: 'mask-draw' });
      layer.addEventListener('pointermove', (e) => { const v = view(); cursor = [e.clientX - v.ox, e.clientY - v.oy]; redraw(); });
      layer.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault();
        const p = inverseTransform(xf, toUv(e), W(), H());
        if (pts.length >= 3) { const f = fwd(xf, pts[0]), v = view(); if (Math.hypot(e.clientX - v.ox - f[0], e.clientY - v.oy - f[1]) < 12) return finishDraw(clip); }
        if (pts.length < MAX_POINTS) pts.push(p);
        redraw();
      });
      layer.addEventListener('dblclick', (e) => { e.stopPropagation(); finishDraw(clip); });
      ov.append(layer);
      if (pts.length) {
        const px = pts.map((p) => fwd(xf, p));
        const line = svg('polyline', { points: [...px, ...(cursor ? [cursor] : [])].map((p) => p.join(',')).join(' '), class: 'mask-line', fill: 'none' });
        ov.append(line);
        px.forEach((p, i) => ov.append(svg('circle', { cx: p[0], cy: p[1], r: i === 0 ? 7 : 4.5, class: `mh${i === 0 ? ' first' : ''}`, 'pointer-events': 'none' })));
      }
      return;
    }

    mask.shapes.forEach((s, i) => {
      const on = i === maskEdit.sel;
      let d;
      if (s.k === 'poly') d = `M${s.pts.map((p) => fwd(xf, p).join(',')).join('L')}Z`;
      else if (s.k === 'rect') { const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => fwd(xf, [s.cx + (a * s.w) / 2, s.cy + (b * s.h) / 2])); d = `M${c.map((p) => p.join(',')).join('L')}Z`; }
      else { const n = 48, c = Array.from({ length: n }, (_, k) => fwd(xf, [s.cx + (Math.cos((k / n) * Math.PI * 2) * s.w) / 2, s.cy + (Math.sin((k / n) * Math.PI * 2) * s.h) / 2])); d = `M${c.map((p) => p.join(',')).join('L')}Z`; }
      const path = svg('path', { d, class: `mask-shape-path${on ? ' on' : ''}${s.sub ? ' sub' : ''}`, 'data-shape': i });
      path.addEventListener('pointerdown', (e) => {
        if (maskEdit.sel !== i) { maskEdit.sel = i; notify(); }
        const start = inv(xf, e);
        gesture(e, (ev) => { const p = inv(xf, ev); const moved = moveShape(s, p[0] - start[0], p[1] - start[1]); Object.assign(s, moved); start[0] = p[0]; start[1] = p[1]; });
      });
      if (s.k === 'poly') path.addEventListener('dblclick', (e) => { const hit = nearestEdge(s, inv(xf, e), 0.04 / xf.s); if (hit) { store.snapshot(); s.pts.splice(hit.index, 0, hit.pt); store.touch('project'); redraw(); } });
      ov.append(path);
      if (!on) return;
      if (s.k === 'poly') s.pts.forEach((p, k) => handle(fwd(xf, p), 'Drag to move · double-click to remove', (e) => {
        gesture(e, (ev) => { s.pts[k] = inv(xf, ev); });
      }, 'pt').addEventListener('dblclick', (e) => { e.stopPropagation(); if (s.pts.length > 3) { store.snapshot(); s.pts.splice(k, 1); store.touch('project'); redraw(); } }));
      else if (s.k === 'rect') [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => handle(fwd(xf, [s.cx + (a * s.w) / 2, s.cy + (b * s.h) / 2]), 'Drag a corner to resize', (e) => {
        const ox = s.cx - (a * s.w) / 2, oy = s.cy - (b * s.h) / 2; // the opposite corner stays put
        gesture(e, (ev) => { const p = inv(xf, ev); s.w = Math.max(0.01, Math.abs(p[0] - ox)); s.h = Math.max(0.01, Math.abs(p[1] - oy)); s.cx = (p[0] + ox) / 2; s.cy = (p[1] + oy) / 2; });
      }));
      else [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([a, b]) => handle(fwd(xf, [s.cx + (a * s.w) / 2, s.cy + (b * s.h) / 2]), 'Drag to resize', (e) => {
        const ox = s.cx - (a * s.w) / 2, oy = s.cy - (b * s.h) / 2;
        gesture(e, (ev) => { const p = inv(xf, ev); if (a) { s.w = Math.max(0.01, Math.abs(p[0] - ox)); s.cx = (p[0] + ox) / 2; } else { s.h = Math.max(0.01, Math.abs(p[1] - oy)); s.cy = (p[1] + oy) / 2; } });
      }));
    });
  }

  function finishDraw(clip) {
    const pts = maskEdit.drawing;
    maskEdit.drawing = null; cursor = null;
    if (pts && pts.length >= 3) addMaskShape(clip, createShape('poly', { pts }));
    else notify();
    redraw();
  }

  addEventListener('keydown', (e) => {
    if (!maskEdit.drawing) return;
    if (e.key === 'Enter') { e.preventDefault(); finishDraw(store.selectedClip); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); maskEdit.drawing = null; cursor = null; notify(); redraw(); }
    else if (e.key === 'Backspace') { e.preventDefault(); maskEdit.drawing.pop(); redraw(); }
  }, true);

  for (const t of ['selection', 'project', 'playhead', 'render', 'maskedit', 'reset']) store.on(t, () => requestAnimationFrame(redraw));
  addEventListener('resize', redraw);
  redraw();
  return { redraw, toScreen: (u, v) => { const p = toPx([u, v]); const vw = view(); return { x: p[0] + vw.ox, y: p[1] + vw.oy }; }, finishDraw: () => finishDraw(store.selectedClip) };
}
