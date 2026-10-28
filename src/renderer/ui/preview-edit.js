// Direct manipulation in the preview: click a text or picture to select it, drag to move it (the whole selection moves together),
// drag the corner handle to scale it, double-click a title to edit its words. One undo step per gesture.
import { el } from './dom.js';
import { store } from '../store.js';
import { drawTextClip } from '../engine/text-renderer.js';
import { resolveClipProps } from '/shared/params.js';
import { activeVisualClips } from '/shared/timeline.js';
import { mediaBox, inBox, boxCenter, alphaBox, snapToCentre } from '/shared/pick.js';

export function mountPreviewEdit({ preview }) {
  const canvas = document.getElementById('preview');
  const wrap = document.getElementById('preview-wrap');
  const box = el('div', { class: 'pick-box', hidden: true }, el('i', { class: 'pick-h', title: 'Drag to scale' }));
  wrap.append(box);
  const handle = box.querySelector('.pick-h');
  const scratch = document.createElement('canvas');
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  let lastBox = null, drag = null;

  /** Where the canvas image really sits on screen (it is letter-boxed inside the element). */
  const view = () => {
    const r = canvas.getBoundingClientRect(), cw = preview.comp.w, ch = preview.comp.h;
    const k = Math.min(r.width / cw, r.height / ch);
    return { left: r.left + (r.width - cw * k) / 2, top: r.top + (r.height - ch * k) / 2, k };
  };
  const toCanvas = (e) => { const v = view(); return { x: (e.clientX - v.left) / v.k, y: (e.clientY - v.top) / v.k }; };

  function boxFor(clip) {
    const W = preview.comp.w, H = preview.comp.h, tl = store.playhead - clip.start;
    const props = resolveClipProps(clip, tl, null);
    if (clip.type === 'text') {
      if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H; }
      drawTextClip(sctx, W, H, clip, tl, { ...props, opacity: 1 });
      return alphaBox(sctx.getImageData(0, 0, W, H).data, W, H);
    }
    return mediaBox(store.project, clip, props, W, H);
  }
  const pickable = (c) => c.type === 'text' || (c.type === 'media' && mediaBox(store.project, c, resolveClipProps(c, 0, null), 100, 100));

  /** Topmost text/picture under the point (text is matched by the box around its letters, so the gaps between words count). */
  function pick(x, y) {
    const list = activeVisualClips(store.project, store.playhead).filter(pickable).reverse();
    for (const c of list) { const b = boxFor(c); if (inBox(b, x, y, 4)) return c; }
    return null;
  }

  function placeBox() {
    const c = store.selectedClip;
    const active = c && !store.playing && store.playhead >= c.start && store.playhead < c.start + c.duration && pickable(c);
    lastBox = active ? boxFor(c) : null;
    box.hidden = !lastBox;
    if (!lastBox) return;
    const v = view(), w = wrap.getBoundingClientRect();
    Object.assign(box.style, { left: `${v.left - w.left + lastBox.x0 * v.k}px`, top: `${v.top - w.top + lastBox.y0 * v.k}px`, width: `${(lastBox.x1 - lastBox.x0) * v.k}px`, height: `${(lastBox.y1 - lastBox.y0) * v.k}px` });
  }
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; placeBox(); }); };
  for (const t of ['selection', 'project', 'playhead', 'render', 'reset']) store.on(t, schedule);
  addEventListener('resize', schedule);

  const movable = () => [...store.multi].map((id) => store.project.clips.find((c) => c.id === id)).filter((c) => c && pickable(c));

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || store.playing) return;
    const p = toCanvas(e), hit = pick(p.x, p.y);
    if (!hit) { if (!e.shiftKey) store.select(null); return; }
    if (e.shiftKey || e.metaKey || e.ctrlKey) { store.toggleSelect(hit.id); return; }
    if (!store.multi.has(hit.id)) store.select(hit.id); else if (store.selection !== hit.id) { store.selection = hit.id; store.emit('selection'); }
    beginMove(e, p);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag || store.playing) return;
    const p = toCanvas(e);
    canvas.style.cursor = lastBox && inBox(lastBox, p.x, p.y, 4) ? 'move' : '';
  });
  canvas.addEventListener('dblclick', (e) => {
    const p = toCanvas(e), hit = pick(p.x, p.y);
    if (hit?.type === 'text') {
      store.select(hit.id);
      document.querySelector('#panel-right [data-tab="inspector"]')?.click(); // the words field lives on the Inspector tab, which may not be the one showing
      let tries = 0;                                                      // the inspector rebuilds for the new selection a moment later
      const focus = () => { const ta = document.querySelector('#inspector textarea'); if (ta) { ta.focus(); ta.select(); } else if (++tries < 15) setTimeout(focus, 40); };
      focus();
    }
  });

  /** Moves every selected text/picture by the pointer's distance. Keyframed positions shift as a whole so animated paths keep their shape. */
  function beginMove(e, start) {
    const W = preview.comp.w, H = preview.comp.h;
    const items = movable().map((c) => ({ c, x: c.props.x, y: c.props.y, kx: structuredClone(c.keyframes?.x || null), ky: structuredClone(c.keyframes?.y || null) }));
    if (!items.length) return;
    drag = { moved: false };
    const prim = items.find((i) => i.c.id === store.selection) || items[0];
    canvas.style.cursor = 'grabbing';
    const move = (ev) => {
      const p = toCanvas(ev), dx = (p.x - start.x) / W, dy = -(p.y - start.y) / H;
      if (!drag.moved) { if (Math.hypot(p.x - start.x, p.y - start.y) < 3) return; store.snapshot(); drag.moved = true; }
      // snap the primary clip to the centre lines and carry the rest by the same amount
      const sx = ev.altKey ? prim.x + dx : snapToCentre(prim.x + dx), sy = ev.altKey ? prim.y + dy : snapToCentre(prim.y + dy);
      const ddx = sx - prim.x, ddy = sy - prim.y;
      for (const i of items) {
        i.c.props.x = i.x + ddx; i.c.props.y = i.y + ddy;
        if (i.kx) i.c.keyframes.x = i.kx.map((k) => ({ ...k, v: k.v + ddx }));
        if (i.ky) i.c.keyframes.y = i.ky.map((k) => ({ ...k, v: k.v + ddy }));
      }
      store.touch('render');
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      canvas.style.cursor = '';
      if (drag?.moved) store.touch('project'); // refresh the inspector once, not on every pointer move
      drag = null;
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  /** Corner handle: scales the selected clip about its own centre. */
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    const c = store.selectedClip;
    if (!c || !lastBox) return;
    const ctr = boxCenter(lastBox), o = c.props.scale, ok = structuredClone(c.keyframes?.scale || null);
    const d0 = Math.max(8, Math.hypot(toCanvas(e).x - ctr.x, toCanvas(e).y - ctr.y));
    let did = false;
    const move = (ev) => {
      if (!did) { store.snapshot(); did = true; }
      const p = toCanvas(ev), f = Math.hypot(p.x - ctr.x, p.y - ctr.y) / d0;
      c.props.scale = Math.min(5, Math.max(0.05, o * f));
      if (ok) c.keyframes.scale = ok.map((k) => ({ ...k, v: Math.min(5, Math.max(0.05, k.v * f)) }));
      store.touch('render');
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (did) store.touch('project'); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });

  /** Canvas pixel → screen coordinates (for tests and tooltips). */
  const toScreen = (x, y) => { const v = view(); return { x: v.left + x * v.k, y: v.top + y * v.k }; };
  return { pick, boxFor, placeBox, toScreen };
}
