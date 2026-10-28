// Parameter resolution: base value -> keyframes -> audio-reactive binding.
import { evalTrack } from './keyframes.js';

export const REACTIVE_SOURCES = ['rms', 'bass', 'mid', 'high', 'beat'];

/**
 * @param owner  object holding {params?, keyframes, bindings}
 * @param key    parameter key
 * @param base   static value (used when no keyframes)
 * @param t      clip-relative time (seconds)
 * @param feats  {rms,bass,mid,high,beat} each 0..1, or null
 * @param range  [min,max] used to scale binding amount and clamp
 */
export function resolveParam(owner, key, base, t, feats, range) {
  let v = evalTrack(owner.keyframes?.[key], t, base);
  const b = owner.bindings?.[key];
  if (b && feats && b.source in feats && b.amount) {
    const span = range ? range[1] - range[0] : 1;
    v += b.amount * feats[b.source] * span;
  }
  if (range) v = Math.min(range[1], Math.max(range[0], v));
  return v;
}

/** Clip-level animatable properties (all visual clips). */
export const CLIP_PROPS = [
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, def: 1 },
  { key: 'x', label: 'Position X', min: -1, max: 1, step: 0.005, def: 0 },
  { key: 'y', label: 'Position Y', min: -1, max: 1, step: 0.005, def: 0 },
  { key: 'scale', label: 'Scale', min: 0.05, max: 5, step: 0.01, def: 1 },
  { key: 'rotation', label: 'Rotation', min: -360, max: 360, step: 0.5, def: 0 },
  { key: 'rotX', label: '3D tilt (X)', min: -180, max: 180, step: 0.5, def: 0 },
  { key: 'rotY', label: '3D turn (Y)', min: -180, max: 180, step: 0.5, def: 0 },
  { key: 'depth', label: '3D perspective', min: 0, max: 1, step: 0.01, def: 0.5 },
];
export const TEXT_PROPS = [
  { key: 'tracking', label: 'Letter spacing (em)', min: -0.2, max: 1.5, step: 0.005, def: 0 },
];
export const BLEND_MODES = ['normal', 'add', 'screen', 'multiply', 'exclusion'];

/** Resolves every clip-level numeric prop at clip-relative time t. */
export function resolveClipProps(clip, t, feats) {
  const out = {};
  for (const d of [...CLIP_PROPS, ...TEXT_PROPS]) {
    out[d.key] = resolveParam(clip, d.key, clip.props[d.key] ?? d.def, t, feats, [d.min, d.max]);
  }
  out.blend = clip.props.blend || 'normal';
  return out;
}

/** 0..1 multiplier from a clip's fade-in / fade-out at clip-relative time t. */
export function fadeFactor(clip, t) {
  let f = 1;
  if (clip.fadeIn > 0) f = Math.min(f, Math.max(0, t / clip.fadeIn));
  if (clip.fadeOut > 0) f = Math.min(f, Math.max(0, (clip.duration - t) / clip.fadeOut));
  return Math.min(1, f);
}

export const TRANSITIONS = { none: 'None', flash: 'Flash cut', punch: 'Zoom punch', glitch: 'Glitch burst', whip: 'Whip slices' };

/**
 * Transition-in envelope for a clip at clip-relative time t. Returns null when inactive, otherwise
 * {scaleMul, effects:[{type, params}]} to apply on top of the clip's own look. e decays 1 → 0 over the duration.
 */
export function transitionAt(clip, t) {
  const tr = clip.transition;
  if (!tr || tr.type === 'none' || !(tr.duration > 0) || t < 0 || t >= tr.duration) return null;
  const e = 1 - t / tr.duration;
  const fx = (type, params) => ({ type, enabled: true, params, keyframes: {}, bindings: {} });
  switch (tr.type) {
    case 'flash': return { scaleMul: 1 + 0.04 * e, effects: [fx('color', { brightness: 1.3 * e * e })] };
    case 'punch': return { scaleMul: 1 + 0.22 * e * e, effects: [fx('chroma', { amount: 0.03 * e, radial: 1 })] };
    case 'glitch': return { scaleMul: 1, effects: [fx('glitch', { amount: 0.9 * e, split: 0.03 * e, rate: 20, blocks: 0.06 }), fx('chroma', { amount: 0.02 * e })] };
    case 'whip': return { scaleMul: 1 + 0.08 * e, effects: [fx('slices', { bands: 7, shift: 0.45 * e, black: 0, rate: 30, split: 0.02 * e })] };
    default: return null;
  }
}
