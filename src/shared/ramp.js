// Speed ramps. A ramp is an ordinary keyframe track on the clip (key `rampSpeed`, clip-relative seconds, value = a multiplier of
// the clip's own speed), so splitting, trimming, copying and undo already treat it like any other animation.
//
// Between two keys the multiplier eases with the same smoothstep as every other keyframe, which has a closed-form integral, so the
// source time a clip shows at any moment is exact (no stepping) and can be inverted. Before the first key / after the last it is flat.
import { evalTrack } from './keyframes.js';

export const RAMP_KEY = 'rampSpeed';
export const RAMP_MIN = 0.1;
export const RAMP_MAX = 4;

export const rampKeys = (clip) => (clip?.keyframes?.[RAMP_KEY] && clip.keyframes[RAMP_KEY].length ? clip.keyframes[RAMP_KEY] : null);
export const hasRamp = (clip) => clip?.type === 'media' && !!rampKeys(clip);

/** Multiplier at clip time tau. */
export const rampAt = (keys, tau) => evalTrack(keys, tau, 1);

/** Seconds of (un-ramped) source covered after tau seconds of the clip: the integral of the multiplier from 0 to tau. */
export function rampIntegral(keys, tau) {
  if (!keys || !keys.length) return tau;
  const v0 = keys[0].v;
  if (tau <= keys[0].t) return tau * v0; // flat before the first key (also for tau < 0, which a head trim can ask for)
  let acc = keys[0].t * v0;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1], d = b.t - a.t;
    if (d <= 0) continue;
    if (tau >= b.t) { acc += (d * (a.v + b.v)) / 2; continue; }
    const u = (tau - a.t) / d; // ∫ smoothstep(w) dw from 0 to u = u³ − u⁴/2
    return acc + d * (a.v * u + (b.v - a.v) * (u ** 3 - (u ** 4) / 2));
  }
  return acc + (tau - keys[keys.length - 1].t) * keys[keys.length - 1].v;
}

/** The clip time at which the integral reaches `s` source seconds (the integral is strictly rising, so bisection is exact enough). */
export function rampInverse(keys, s) {
  if (!keys || !keys.length || !Number.isFinite(s)) return s;
  if (s <= 0) return s / keys[0].v;
  let lo = 0, hi = Math.max(1, s / Math.max(RAMP_MIN, Math.min(...keys.map((k) => k.v))));
  while (rampIntegral(keys, hi) < s) hi *= 2;
  for (let i = 0; i < 48; i++) { const mid = (lo + hi) / 2; if (rampIntegral(keys, mid) < s) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** Source seconds a clip consumes over `tau` seconds of timeline, at its constant speed times the ramp. */
export const sourceAdvance = (clip, tau) => (clip.speed || 1) * (hasRamp(clip) ? rampIntegral(rampKeys(clip), tau) : tau);
/** Timeline seconds needed to consume `src` seconds of source. */
export const timelineFor = (clip, src) => (hasRamp(clip) ? rampInverse(rampKeys(clip), src / (clip.speed || 1)) : src / (clip.speed || 1));
/** Instantaneous playback rate (clip speed × ramp) at clip time tau. */
export const rateAt = (clip, tau) => (clip.speed || 1) * (hasRamp(clip) ? rampAt(rampKeys(clip), tau) : 1);

/**
 * Makes sure a key sits exactly at tau, so a cut there leaves both halves with the curve's shape. A smoothstep cannot be cut
 * part-way and stay a smoothstep, so the segment being cut is re-drawn through a dozen points sampled from the original curve.
 */
export function ensureKeyAt(keys, tau) {
  if (!keys.length || keys.some((k) => Math.abs(k.t - tau) < 1e-6)) return keys;
  const out = [...keys];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (tau > a.t && tau < b.t) for (let j = 1; j < SAMPLES; j++) { const t = a.t + ((b.t - a.t) * j) / SAMPLES; if (Math.abs(t - tau) > 1e-6) out.push({ t, v: rampAt(keys, t) }); }
  }
  out.push({ t: tau, v: rampAt(keys, tau) });
  return out.sort((x, y) => x.t - y.t);
}
const SAMPLES = 12;

/** Head trim by `delta` clip seconds: slides the curve and returns the source seconds the in-point must advance (negative when extending). */
export function trimRampHead(clip, delta) {
  const keys = rampKeys(clip);
  if (!keys) return (clip.speed || 1) * delta;
  const adv = (clip.speed || 1) * rampIntegral(keys, delta);
  let k = delta > 0 ? ensureKeyAt(keys, delta).filter((p) => p.t >= delta - 1e-9) : keys;
  clip.keyframes[RAMP_KEY] = k.map((p) => ({ t: p.t - delta, v: p.v }));
  return adv;
}

/** Mirrors the curve in time (used when a clip is reversed). */
export function mirrorRamp(clip) {
  const keys = rampKeys(clip);
  if (keys) clip.keyframes[RAMP_KEY] = keys.map((p) => ({ t: clip.duration - p.t, v: p.v })).filter((p) => p.t >= -1e-9).sort((a, b) => a.t - b.t);
}

// ---- ready-made curves; all values are multipliers on the clip speed, times are fractions of the clip (0..1) ----
export const RAMP_SHAPES = {
  'slow-mo dip': [[0, 1], [0.35, 1], [0.5, 0.25], [0.65, 1], [1, 1]],
  'hit and slide': [[0, 1.8], [0.15, 1.8], [0.4, 0.3], [1, 0.2]],
  'whip up': [[0, 0.3], [0.5, 0.5], [0.85, 3], [1, 3]],
  'freeze-ish end': [[0, 1], [0.6, 1], [1, 0.1]],
  'ease in': [[0, 0.2], [1, 1.5]],
};

export function shapeKeys(name, duration) {
  const s = RAMP_SHAPES[name];
  return s ? s.map(([u, v]) => ({ t: u * duration, v })) : null;
}

/** Beat pulse: fast on every beat that falls inside the clip, easing down to `low` between beats. beats are timeline seconds. */
export function beatPulseKeys(clip, beats, { high = 2.2, low = 0.45 } = {}) {
  const inside = beats.filter((b) => b >= clip.start && b < clip.start + clip.duration).map((b) => b - clip.start);
  if (inside.length < 2) return null;
  const keys = [];
  for (let i = 0; i < inside.length; i++) {
    const gap = (inside[i + 1] ?? inside[i] + (inside[i] - inside[i - 1])) - inside[i];
    keys.push({ t: inside[i], v: high }, { t: inside[i] + gap * 0.45, v: low });
  }
  return keys.filter((k) => k.t <= clip.duration).sort((a, b) => a.t - b.t);
}

/** Source seconds used by the whole clip, and whether that fits the file. */
export function rampBudget(clip, mediaDuration) {
  const used = sourceAdvance(clip, clip.duration);
  return { used, available: Math.max(0, mediaDuration - (clip.in || 0)), fits: !Number.isFinite(mediaDuration) || used <= mediaDuration - (clip.in || 0) + 1e-6 };
}
