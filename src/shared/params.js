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
];
export const TEXT_PROPS = [
  { key: 'tracking', label: 'Letter spacing (em)', min: -0.2, max: 1.5, step: 0.005, def: 0 },
];
export const BLEND_MODES = ['normal', 'add', 'screen', 'multiply'];

/** Resolves every clip-level numeric prop at clip-relative time t. */
export function resolveClipProps(clip, t, feats) {
  const out = {};
  for (const d of [...CLIP_PROPS, ...TEXT_PROPS]) {
    out[d.key] = resolveParam(clip, d.key, clip.props[d.key] ?? d.def, t, feats, [d.min, d.max]);
  }
  out.blend = clip.props.blend || 'normal';
  return out;
}
