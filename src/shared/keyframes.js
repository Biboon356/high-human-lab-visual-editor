// Keyframe tracks: sorted arrays of {t, v}. Interpolation is smoothstep between keys.
const EPS = 1e-4;

export function evalTrack(keys, t, fallback) {
  if (!keys || keys.length === 0) return fallback;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / Math.max(b.t - a.t, EPS);
      const s = u * u * (3 - 2 * u);
      return a.v + (b.v - a.v) * s;
    }
  }
  return last.v;
}

export function keyAt(keys, t, tol = 0.02) {
  return (keys || []).findIndex((k) => Math.abs(k.t - t) <= tol);
}

/** Sets (or replaces) a key at time t; returns the new array (sorted). */
export function setKey(keys, t, v) {
  const out = (keys || []).slice();
  const i = keyAt(out, t);
  if (i >= 0) out[i] = { t: out[i].t, v };
  else out.push({ t, v });
  out.sort((a, b) => a.t - b.t);
  return out;
}

export function removeKey(keys, t) {
  const out = (keys || []).slice();
  const i = keyAt(out, t);
  if (i >= 0) out.splice(i, 1);
  return out;
}
