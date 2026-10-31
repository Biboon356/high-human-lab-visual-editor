// Gestures: a hand moving over the picture, kept as timed points. A gesture is NOT an animation format — it is turned into ordinary
// keyframe tracks (mapGesture) or into a path a generator draws (trace generator), and the original timing and wobble survive.
//   pts: [[t, u, v, stroke], …]   t = timeline seconds, u/v = 0..1 across/down the frame, stroke = which pen-down it belongs to
import { simplifyTrack, smoothValues } from './simplify.js';

export const MIN_DT = 1 / 120; // a pointer can report faster than any frame; extra samples carry nothing
export const MAX_POINTS = 24000;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export const createGesture = () => ({ pts: [], strokes: 0 });
export const beginStroke = (g) => { g.strokes++; return g.strokes - 1; };

export function addPoint(g, t, u, v, stroke = g.strokes - 1) {
  if (stroke < 0 || g.pts.length >= MAX_POINTS || ![t, u, v].every(Number.isFinite)) return false;
  const last = g.pts.at(-1);
  if (last && last[3] === stroke && t - last[0] < MIN_DT) return false;
  g.pts.push([t, clamp01(u), clamp01(v), stroke]);
  return true;
}

export const gestureRange = (g) => (g.pts.length ? { t0: g.pts[0][0], t1: g.pts.at(-1)[0] } : null);

/** Speed of the hand at each point in frame-heights per second (so a diagonal across the picture is the same speed on any aspect). */
export function speeds(g, aspect = 16 / 9) {
  const out = new Array(g.pts.length).fill(0);
  for (let i = 1; i < g.pts.length; i++) {
    const a = g.pts[i - 1], b = g.pts[i];
    if (a[3] !== b[3]) continue;
    const dt = Math.max(1e-3, b[0] - a[0]);
    out[i] = Math.hypot((b[1] - a[1]) * aspect, b[2] - a[2]) / dt;
  }
  // a little smoothing: raw pointer speed is spiky
  return out.map((_, i) => (out[Math.max(0, i - 1)] + 2 * out[i] + out[Math.min(out.length - 1, i + 1)]) / 4);
}

/** Pen-up gaps hold the last value (and speed 0), so a stroke ending is a rest, not a glide to the next stroke. */
function withHolds(samples, restValue = null) {
  const out = [];
  samples.forEach((p, i) => {
    const prev = samples[i - 1];
    if (prev && p.gap) {
      out.push({ t: prev.t + 0.02, v: restValue ?? prev.v });
      out.push({ t: Math.max(prev.t + 0.03, p.t - 0.03), v: restValue ?? prev.v });
    }
    out.push({ t: p.t, v: p.v });
  });
  return out;
}

/** The four signals a gesture offers, each 0..1, as sample lists in timeline seconds. */
export function gestureSeries(g, { aspect = 16 / 9, speedFull = 2 } = {}) {
  const sp = speeds(g, aspect);
  const mk = (f, rest) => withHolds(g.pts.map((p, i) => ({ t: p[0], v: f(p, i), gap: i > 0 && p[3] !== g.pts[i - 1][3] })), rest);
  return { x: mk((p) => p[1]), y: mk((p) => p[2]), speed: mk((_, i) => clamp01(sp[i] / speedFull), 0) };
}

/**
 * @param mappings [{owner, key, offset, axis: 'x'|'y'|'speed', fn: (axisValue 0..1) => parameter value, range: [min,max]}]
 *   offset = the owner's start time on the timeline, so the track comes out in the owner's own (clip-relative) seconds.
 * @param o {tol, smooth, aspect}
 * @returns [{owner, key, track: [{t, v}], t0, t1}]
 */
export function mapGesture(g, mappings, { tol = 0.02, smooth = 0.3, aspect = 16 / 9 } = {}) {
  if (!g.pts.length) return [];
  const series = gestureSeries(g, { aspect });
  const { t1 } = gestureRange(g);
  return mappings.map((m) => {
    const raw = (series[m.axis] || []).map((p) => ({ t: p.t - m.offset, v: Math.min(m.range[1], Math.max(m.range[0], m.fn(p.v))) }));
    const track = simplifyTrack(smoothValues(raw, smooth), { tol, range: m.range });
    return { owner: m.owner, key: m.key, track, t0: track[0]?.t ?? 0, t1: Math.max(track.at(-1)?.t ?? 0, t1 - m.offset) };
  });
}

/** Thins a gesture's points for storage in a generator (keeps timing, drops points that do not bend the line). */
export function simplifyPath(g, { minStep = 0.004 } = {}) {
  const out = [];
  for (const p of g.pts) {
    const last = out.at(-1);
    if (last && last[3] === p[3] && Math.hypot(p[1] - last[1], p[2] - last[2]) < minStep && p !== g.pts.at(-1)) continue;
    out.push([Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1e4) / 1e4, Math.round(p[2] * 1e4) / 1e4, p[3]]);
  }
  return out;
}

/**
 * A smooth curve through the recorded points (Catmull-Rom), so a quick or sparse gesture does not draw as a polyline of straight kinks.
 * Every original point is kept exactly, times are interpolated linearly (so the timing of the hand is unchanged), strokes stay apart.
 * @param pts [[t,u,v,stroke],…]  @param o {aspect, step: target spacing in frame heights}
 */
export function smoothPath(pts, { aspect = 16 / 9, step = 0.012 } = {}) {
  const out = [];
  let i = 0;
  while (i < pts.length) {
    let j = i;
    while (j + 1 < pts.length && pts[j + 1][3] === pts[i][3]) j++;
    const s = pts.slice(i, j + 1);
    for (let k = 0; k < s.length; k++) {
      const p1 = s[k], p2 = s[k + 1];
      out.push(p1);
      if (!p2) break;
      const p0 = s[k - 1] || p1, p3 = s[k + 2] || p2;
      const n = Math.min(40, Math.floor(Math.hypot((p2[1] - p1[1]) * aspect, p2[2] - p1[2]) / step));
      for (let m = 1; m < n; m++) {
        const f = m / n, f2 = f * f, f3 = f2 * f;
        const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3);
        out.push([p1[0] + (p2[0] - p1[0]) * f, clamp01(cr(p0[1], p1[1], p2[1], p3[1])), clamp01(cr(p0[2], p1[2], p2[2], p3[2])), p1[3]]);
      }
    }
    i = j + 1;
  }
  return out;
}
