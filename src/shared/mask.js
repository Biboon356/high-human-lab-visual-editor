// Masks and mattes. A mask is a set of shapes (rectangle / ellipse / drawn polygon) that decides which part of a clip is visible;
// a matte uses another clip's picture (its alpha or its brightness) the same way. Both are pure data here — the compositor rasterises them.
//
// Shapes live in frame coordinates u,v ∈ 0..1 (v runs top → bottom, like the picture). The mask as a whole can be moved, scaled,
// turned, feathered and grown over time through the clip props below, so a mask follows a subject without animating every point.

export const MASK_PROPS = [
  { key: 'maskX', label: 'Mask X', min: -1, max: 1, step: 0.005, def: 0 },
  { key: 'maskY', label: 'Mask Y', min: -1, max: 1, step: 0.005, def: 0 },
  { key: 'maskScale', label: 'Mask scale', min: 0.05, max: 5, step: 0.01, def: 1 },
  { key: 'maskRot', label: 'Mask rotation', min: -360, max: 360, step: 0.5, def: 0 },
  { key: 'maskFeather', label: 'Feather', min: 0, max: 1, step: 0.01, def: 0.15 },
  { key: 'maskGrow', label: 'Grow / shrink', min: -1, max: 1, step: 0.01, def: 0 },
];
export const MASK_DEFAULTS = Object.fromEntries(MASK_PROPS.map((d) => [d.key, d.def]));

export const SHAPE_KINDS = ['rect', 'ellipse', 'poly'];
export const MAX_POINTS = 64;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function createShape(kind, opts = {}) {
  if (kind === 'rect') return { k: 'rect', cx: 0.5, cy: 0.5, w: 0.5, h: 0.5, r: 0, sub: false, ...opts };
  if (kind === 'ellipse') return { k: 'ellipse', cx: 0.5, cy: 0.5, w: 0.5, h: 0.5, sub: false, ...opts };
  if (kind === 'poly') return { k: 'poly', pts: (opts.pts || [[0.3, 0.7], [0.5, 0.25], [0.7, 0.7]]).slice(0, MAX_POINTS).map(([u, v]) => [u, v]), sub: !!opts.sub };
  throw new Error(`Unknown mask shape "${kind}"`);
}

export const createMask = (kind = 'ellipse', opts) => ({ shapes: [createShape(kind, opts)], invert: false });

/** Makes a loaded/hand-edited mask safe to draw. Returns null when nothing usable is left. */
export function normalizeMask(m) {
  if (!m || !Array.isArray(m.shapes)) return null;
  const shapes = [];
  for (const s of m.shapes) {
    if (!s || !SHAPE_KINDS.includes(s.k)) continue;
    if (s.k === 'poly') { const pts = (s.pts || []).filter((p) => Array.isArray(p) && p.every(Number.isFinite)).slice(0, MAX_POINTS); if (pts.length >= 3) shapes.push({ k: 'poly', pts, sub: !!s.sub }); }
    else if ([s.cx, s.cy, s.w, s.h].every(Number.isFinite)) shapes.push({ ...s, w: Math.max(0.001, s.w), h: Math.max(0.001, s.h), r: Math.min(0.5, Math.max(0, s.r || 0)), sub: !!s.sub });
  }
  return shapes.length ? { shapes, invert: !!m.invert } : null;
}

export function shapeBounds(s) {
  if (s.k === 'poly') { const us = s.pts.map((p) => p[0]), vs = s.pts.map((p) => p[1]); return { u0: Math.min(...us), v0: Math.min(...vs), u1: Math.max(...us), v1: Math.max(...vs) }; }
  return { u0: s.cx - s.w / 2, v0: s.cy - s.h / 2, u1: s.cx + s.w / 2, v1: s.cy + s.h / 2 };
}
export function maskBounds(mask) {
  const b = mask.shapes.filter((s) => !s.sub).map(shapeBounds);
  const list = b.length ? b : mask.shapes.map(shapeBounds);
  return { u0: Math.min(...list.map((x) => x.u0)), v0: Math.min(...list.map((x) => x.v0)), u1: Math.max(...list.map((x) => x.u1)), v1: Math.max(...list.map((x) => x.v1)) };
}
export const maskPivot = (mask) => { const b = maskBounds(mask); return { u: (b.u0 + b.u1) / 2, v: (b.v0 + b.v1) / 2 }; };

/**
 * The mask's whole-shape transform at one moment. props: resolved maskX/maskY/maskScale/maskRot (see MASK_PROPS).
 * Turning and scaling happen about the middle of the shapes; the offset then slides everything (Y up, like clip position).
 */
export function maskTransform(mask, props) {
  const pv = maskPivot(mask);
  return { pu: pv.u, pv: pv.v, dx: props.maskX ?? 0, dy: -(props.maskY ?? 0), s: props.maskScale ?? 1, rot: ((props.maskRot ?? 0) * Math.PI) / 180 };
}

/** Shape-space point -> where it appears in the frame (uv). W,H keep rotation true on a non-square frame. */
export function applyTransform(xf, [u, v], W, H) {
  const x = (u - xf.pu) * W * xf.s, y = (v - xf.pv) * H * xf.s, c = Math.cos(xf.rot), si = Math.sin(xf.rot);
  return [xf.pu + (c * x - si * y) / W + xf.dx, xf.pv + (si * x + c * y) / H + xf.dy];
}
export function inverseTransform(xf, [u, v], W, H) {
  const x = (u - xf.pu - xf.dx) * W, y = (v - xf.pv - xf.dy) * H, c = Math.cos(-xf.rot), si = Math.sin(-xf.rot);
  return [xf.pu + (c * x - si * y) / (W * xf.s), xf.pv + (si * x + c * y) / (H * xf.s)];
}

/** Is the shape-space point inside the shape? (used by tests and by click-to-select in the editor) */
export function pointInShape(s, [u, v]) {
  if (s.k === 'rect') return Math.abs(u - s.cx) <= s.w / 2 && Math.abs(v - s.cy) <= s.h / 2;
  if (s.k === 'ellipse') return ((u - s.cx) / (s.w / 2)) ** 2 + ((v - s.cy) / (s.h / 2)) ** 2 <= 1;
  let inside = false;
  for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
    const [xi, yi] = s.pts[i], [xj, yj] = s.pts[j];
    if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Coverage 0/1 of a point by the whole mask in shape space (hard edge — feather is applied by the rasteriser). */
export function pointInMask(mask, pt) {
  let on = false;
  for (const s of mask.shapes) if (!s.sub && pointInShape(s, pt)) on = true;
  for (const s of mask.shapes) if (s.sub && pointInShape(s, pt)) on = false;
  return mask.invert ? !on : on;
}

/** Moves a whole shape by (du,dv) in shape space. */
export function moveShape(s, du, dv) {
  if (s.k === 'poly') return { ...s, pts: s.pts.map(([u, v]) => [u + du, v + dv]) };
  return { ...s, cx: s.cx + du, cy: s.cy + dv };
}

/** Where a poly edge click should insert a new point: the nearest edge within `tol` (uv). Returns {index, pt} or null. */
export function nearestEdge(s, [u, v], tol = 0.03) {
  let best = null;
  for (let i = 0; i < s.pts.length; i++) {
    const [ax, ay] = s.pts[i], [bx, by] = s.pts[(i + 1) % s.pts.length];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-9;
    const t = Math.min(1, Math.max(0, ((u - ax) * dx + (v - ay) * dy) / len2));
    const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(u - px, v - py);
    if (d <= tol && (!best || d < best.d)) best = { d, index: i + 1, pt: [px, py] };
  }
  return best;
}

/** Stable text key for the rasterised result, so an unchanged mask is not redrawn every frame. */
export function maskKey(mask, props, W, H) {
  const r = (v) => Math.round(v * 1000) / 1000;
  return `${W}x${H}|${mask.invert ? 1 : 0}|${r(props.maskX)}|${r(props.maskY)}|${r(props.maskScale)}|${r(props.maskRot)}|${r(props.maskFeather)}|${r(props.maskGrow)}|${JSON.stringify(mask.shapes)}`;
}

// ---- mattes: another clip's picture decides what shows ----
export const MATTE_USES = ['alpha', 'luma'];

export function normalizeMatte(m) {
  if (!m || typeof m.source !== 'string') return null;
  return { source: m.source, use: MATTE_USES.includes(m.use) ? m.use : 'alpha', invert: !!m.invert };
}

/** Can `srcId` be this clip's matte? It must be a picture clip other than itself, and not one that is itself matted by this clip. */
export function canBeMatte(project, clip, srcId) {
  const src = project.clips.find((c) => c.id === srcId);
  if (!src || src.id === clip.id || src.type === 'adjust') return false;
  const track = project.tracks.find((t) => t.id === src.trackId);
  if (!track || track.kind !== 'video') return false;
  return src.matte?.source !== clip.id;
}

/** Clips that serve as someone's matte are not drawn on their own (like a hidden matte layer in a compositor). */
export function matteSourceIds(project) {
  const out = new Set();
  for (const c of project.clips) if (c.matte && canBeMatte(project, c, c.matte.source)) out.add(c.matte.source);
  return out;
}
export const clamp = clamp01;
