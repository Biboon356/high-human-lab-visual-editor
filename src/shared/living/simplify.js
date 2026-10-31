// Turning thousands of recorded samples into a few keyframes that still *play back* like the performance.
// The editor interpolates keyframes with smoothstep (shared/keyframes.js), so a plain line-simplifier would be wrong: this one checks
// every candidate against the real interpolation and keeps adding the key where the curve is furthest off.
import { evalTrack } from '../keyframes.js';

/** Sorted by time, one sample per instant (the later one wins), finite values only. */
export function cleanSamples(samples) {
  const s = samples.filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v)).map((p) => ({ t: p.t, v: p.v })).sort((a, b) => a.t - b.t);
  const out = [];
  for (const p of s) { if (out.length && Math.abs(out.at(-1).t - p.t) < 1e-6) out[out.length - 1] = p; else out.push(p); }
  return out;
}

/** Largest gap between the samples and what the keyframes would play back. */
export function maxError(samples, keys) {
  let m = 0;
  for (const p of samples) m = Math.max(m, Math.abs(evalTrack(keys, p.t, p.v) - p.v));
  return m;
}

/**
 * Light moving average of the values over a short *time* window (times untouched, end points kept). strength 0..1 widens it up to
 * ±0.08 s. It is a window in seconds, not in samples, so a rest (samples far apart) stays flat instead of being dragged into the
 * next move.
 */
export function smoothValues(samples, strength = 0) {
  const half = Math.max(0, Math.min(1, strength)) * 0.08;
  if (half < 0.004 || samples.length < 3) return samples;
  return samples.map((p, i) => {
    if (i === 0 || i === samples.length - 1) return p;
    let s = 0, n = 0;
    for (let j = i; j >= 0 && p.t - samples[j].t <= half; j--) { s += samples[j].v; n++; }
    for (let j = i + 1; j < samples.length && samples[j].t - p.t <= half; j++) { s += samples[j].v; n++; }
    return { t: p.t, v: s / n };
  });
}

/**
 * @param samples [{t, v}] in any order
 * @param o {tol: allowed error as a fraction of the value range, range: [min,max] of the parameter, maxKeys}
 * @returns keyframes [{t, v}] (always includes the first and last sample)
 */
export function simplifyTrack(samples, { tol = 0.02, range = null, maxKeys = 80 } = {}) {
  const pts = cleanSamples(samples);
  if (pts.length <= 2) return pts;
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
  const span = range ? range[1] - range[0] : hi - lo;
  const eps = Math.max(1e-9, tol * (span > 1e-9 ? span : 1));
  // Seed with the turning points: smoothstep is flat at every key, so peaks and troughs are where keys do the most good.
  const idx = new Set([0, pts.length - 1]);
  let top = 0, bot = 0, dir = 0; // zigzag: a turning point counts once the value has come back by more than the tolerance
  for (let i = 1; i < pts.length; i++) {
    const v = pts[i].v;
    if (v > pts[top].v) top = i;
    if (v < pts[bot].v) bot = i;
    if (dir >= 0 && top !== i && pts[top].v - v > eps) { idx.add(top); dir = -1; top = bot = i; }
    else if (dir <= 0 && bot !== i && v - pts[bot].v > eps) { idx.add(bot); dir = 1; top = bot = i; }
  }
  let keys = [...idx].sort((a, b) => a - b).map((i) => pts[i]);
  while (keys.length < maxKeys) {
    let worst = -1, err = eps;
    for (let i = 1; i < pts.length - 1; i++) {
      const e = Math.abs(evalTrack(keys, pts[i].t, pts[i].v) - pts[i].v);
      if (e > err) { err = e; worst = i; }
    }
    if (worst < 0) break;
    keys.push(pts[worst]);
    keys.sort((a, b) => a.t - b.t);
  }
  // prune: drop any key whose removal leaves every sample within tolerance (the turning-point seeds can be redundant)
  for (let i = keys.length - 2; i >= 1; i--) {
    const without = keys.filter((_, j) => j !== i);
    if (maxError(pts, without) <= eps) keys = without;
  }
  return keys;
}

/**
 * Puts a freshly performed stretch of a track over an existing one: old keys outside [t0, t1] stay, the performance replaces what was
 * inside. Returns a new sorted array.
 */
export function punchMerge(old, fresh, t0, t1) {
  const kept = (old || []).filter((k) => k.t < t0 - 1e-6 || k.t > t1 + 1e-6);
  return cleanSamples([...kept, ...fresh]);
}
