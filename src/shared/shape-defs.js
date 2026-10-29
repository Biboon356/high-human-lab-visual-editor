// Shape clips: drawn ornaments and plates (rules, frames, arches, flames, lotus, suns, tape…). They are ordinary clips — move, scale,
// turn, fade, keyframe and stack effects on them like a title. Sizes are fractions of the frame (w of width, h of height); the
// "uniform" kinds keep w and h equal in pixels, so one Size control is enough.
import { createClip, defaultProps } from './project.js';

export const SHAPES = {
  rect: { label: 'Plate / rule', w: 0.4, h: 0.012, color: '#f4efe3', fill: true, ratio: 0 },
  divider: { label: 'Ornament rule', w: 0.34, h: 0.03, color: '#d9c27a', fill: true, stroke: 0.003 },
  frame: { label: 'Double frame', w: 0.8, h: 0.8, color: '#f4efe3', fill: false, stroke: 0.004, ratio: 0.5 },
  arch: { label: 'Pointed arch (window)', w: 0.22, h: 0.7, color: '#d9c27a', fill: false, stroke: 0.005, ratio: 0.5 },
  ellipse: { label: 'Disc / ring', uniform: true, size: 0.4, color: '#ffffff', fill: true },
  diamond: { label: 'Diamond', uniform: true, size: 0.1, color: '#f4efe3', fill: true },
  star: { label: 'Star / sparkle', uniform: true, size: 0.12, color: '#ffe9a8', fill: true, n: 4, ratio: 0.28 },
  sun: { label: 'Sun with rays', uniform: true, size: 0.42, color: '#ffcf5a', fill: true, n: 24, ratio: 0.5 },
  retrosun: { label: 'Retro sun (slatted)', uniform: true, size: 0.45, color: '#ffd36a', color2: '#ff3f9e', fill: true, n: 7 },
  flame: { label: 'Flame (diya)', w: 0.09, h: 0.2, color: '#ffb02e', color2: '#fff3b0', fill: true },
  lotus: { label: 'Lotus (petals)', uniform: true, size: 0.3, color: '#f7d6e8', color2: '#e060a0', fill: true, n: 9, ratio: 0.55 },
  rosette: { label: 'Rosette (circle ring)', uniform: true, size: 0.36, color: '#d9c27a', fill: false, stroke: 0.003, n: 12 },
  dotrow: { label: 'Row of dots', w: 0.3, h: 0.012, color: '#f4efe3', fill: true, n: 9 },
  stripes: { label: 'Hazard stripes', w: 0.6, h: 0.05, color: '#ffe066', color2: '#111111', fill: true, n: 14 },
  tape: { label: 'Tape strip', w: 0.22, h: 0.06, color: 'rgba(255,236,150,0.82)', fill: true },
};
export const SHAPE_KINDS = Object.keys(SHAPES);

export function defaultShape(kind = 'rect') {
  const d = SHAPES[kind] || SHAPES.rect;
  const size = d.uniform ? d.size : null;
  return {
    kind, w: d.w ?? 0.2, h: d.h ?? 0.2, // fractions of the frame width / height
    color: d.color, color2: d.color2 || null, gradient: !!d.color2,
    fill: d.fill !== false, stroke: d.stroke ?? 0, strokeColor: d.color, n: d.n ?? 8, ratio: d.ratio ?? 0.5,
    glow: 0, shadow: 0, spin: 0, // spin: degrees per second
    ...(size ? { size } : {}),
  };
}

/** Pixel half-extents of a shape on a W×H frame (uniform kinds use their size on both sides). */
export function shapeBox(s, W, H) {
  const d = SHAPES[s.kind] || {};
  if (d.uniform) { const px = (s.size ?? d.size) * H; return { hw: px / 2, hh: px / 2 }; }
  return { hw: (s.w * W) / 2, hh: (s.h * H) / 2 };
}

export function createShapeClip(kind, start = 0, duration = 4, overrides = {}) {
  const shape = { ...defaultShape(kind), ...overrides };
  return createClip({ type: 'shape', name: SHAPES[kind]?.label || 'Shape', start, duration, shape, props: defaultProps() });
}

/** Makes a loaded or hand-edited shape safe to draw. */
export function normalizeShape(s) {
  const base = defaultShape(SHAPES[s?.kind] ? s.kind : 'rect');
  const out = { ...base, ...(s || {}) };
  if (!SHAPES[out.kind]) out.kind = 'rect';
  for (const k of ['w', 'h', 'size', 'stroke', 'ratio', 'glow', 'shadow', 'spin']) if (out[k] !== undefined && !Number.isFinite(out[k])) out[k] = base[k];
  out.n = Math.min(64, Math.max(1, Math.round(Number.isFinite(out.n) ? out.n : base.n)));
  return out;
}
