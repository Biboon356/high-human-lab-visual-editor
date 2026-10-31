// Procedural root systems: seeded, branching, tapering polylines. Pure geometry (no drawing), unit-testable.
// Coordinates are in "frame heights": x spans 0..aspect, y spans 0..1, y grows downward like a canvas.

function rng(seed) {
  let s = (Math.floor(seed * 1000) >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export const ORIGINS = ['Top (hanging roots)', 'Bottom (growing up)', 'Left', 'Center (radial)'];
const MAX_SEGMENTS = 7000;

/**
 * @param {{seed:number, density:number, curve:number, aspect:number, origin:number, thickness:number}} o
 * @returns {{segs: Float32Array, count:number}} packed segments: [x0,y0,x1,y1,w0,w1,birth,depth] * count, birth normalised to 0..1
 */
export function buildRoots({ seed = 7, density = 1, curve = 0.5, aspect = 16 / 9, origin = 0, thickness = 0.15 }) {
  const rand = rng(seed + origin * 13.37);
  const out = [];
  let maxPath = 1e-6;
  const baseW = 0.004 + thickness * 0.05; // trunk width in frame heights
  const step = 0.01;

  function grow(x, y, ang, len, w, depth, path, bias) {
    const wEnd = w * (depth === 0 ? 0.25 : 0.12);
    const steps = Math.max(2, Math.round(len / step));
    for (let i = 0; i < steps && out.length < MAX_SEGMENTS; i++) {
      const f0 = i / steps, f1 = (i + 1) / steps;
      ang += (rand() - 0.5) * curve * 0.55 + Math.sin(bias.phase + path * 6) * 0.01 * curve + (bias.dir - ang) * 0.02;
      const nx = x + Math.cos(ang) * step, ny = y + Math.sin(ang) * step;
      const w0 = w + (wEnd - w) * f0, w1 = w + (wEnd - w) * f1;
      out.push([x, y, nx, ny, w0, w1, path, depth]);
      x = nx; y = ny; path += step;
      if (path > maxPath) maxPath = path;
      if (nx < -0.2 || nx > aspect + 0.2 || ny < -0.2 || ny > 1.2) break;
      // side branches get rarer as the root thins and with depth
      if (depth < 4 && w1 > baseW * 0.12 && rand() < 0.045 * (0.5 + density * 0.5) / (1 + depth * 0.6)) {
        const side = rand() < 0.5 ? -1 : 1;
        grow(x, y, ang + side * (0.45 + rand() * 0.7), len * (0.35 + rand() * 0.3), w1 * 0.7, depth + 1, path, { dir: ang + side * 0.3, phase: rand() * 6 });
      }
      // fine rootlets
      if (depth >= 1 && rand() < 0.03 * density) {
        const side = rand() < 0.5 ? -1 : 1;
        grow(x, y, ang + side * (0.8 + rand() * 0.8), 0.03 + rand() * 0.05, Math.max(baseW * 0.08, 0.0012), 5, path, { dir: ang + side, phase: 0 });
      }
    }
  }

  const n = Math.max(2, Math.min(16, Math.round(2 + density * 3.2)));
  for (let r = 0; r < n; r++) {
    const u = (r + 0.2 + rand() * 0.6) / n;
    let x, y, ang;
    if (origin === 0) { x = u * aspect; y = -0.02; ang = Math.PI / 2 + (rand() - 0.5) * 0.7; }
    else if (origin === 1) { x = u * aspect; y = 1.02; ang = -Math.PI / 2 + (rand() - 0.5) * 0.7; }
    else if (origin === 2) { x = -0.02; y = u; ang = (rand() - 0.5) * 0.7; }
    else { x = aspect / 2; y = 0.5; ang = (r / n) * Math.PI * 2 + rand() * 0.5; }
    const len = 0.5 + rand() * 0.55;
    grow(x, y, ang, len, baseW * (0.8 + rand() * 0.5), 0, 0, { dir: ang, phase: rand() * 6 });
  }
  const segs = new Float32Array(out.length * 8);
  out.forEach((s, i) => {
    segs.set([s[0], s[1], s[2], s[3], s[4], s[5], s[6] / maxPath, s[7]], i * 8);
  });
  return { segs, count: out.length };
}

/**
 * Roots that grow along a hand-drawn path. Geometry only, like buildRoots, in frame heights (x spans 0..aspect, y 0..1, y down).
 * Unlike buildRoots, `birth` is in SECONDS of the gesture, so the roots appear exactly as fast as the hand moved (a pause is a pause).
 * @param pts   [[t, u, v, stroke], …] gesture points, t relative to the start of the gesture, u/v 0..1 across/down the frame
 * @param o     {seed, density (branching), curve (wander), thickness, aspect, growSpeed (frame heights per second the side roots grow)}
 * @returns {{segs: Float32Array, count:number, duration:number}} packed like buildRoots: [x0,y0,x1,y1,w0,w1,birthSeconds,depth] * count
 */
export function buildRootsAlong(pts, { seed = 7, density = 1, curve = 0.5, thickness = 0.15, aspect = 16 / 9, growSpeed = 0.35 } = {}) {
  const rand = rng(seed);
  const out = [];
  const baseW = 0.004 + thickness * 0.05;
  let duration = 0;

  function branch(x, y, ang, len, w, depth, birth) {
    const step = 0.012, steps = Math.max(2, Math.round(len / step)), wEnd = w * 0.12;
    for (let i = 0; i < steps && out.length < MAX_SEGMENTS; i++) {
      ang += (rand() - 0.5) * curve * 0.7;
      const nx = x + Math.cos(ang) * step, ny = y + Math.sin(ang) * step, f0 = i / steps, f1 = (i + 1) / steps;
      out.push([x, y, nx, ny, w + (wEnd - w) * f0, w + (wEnd - w) * f1, birth, depth]);
      birth += step / growSpeed; duration = Math.max(duration, birth);
      x = nx; y = ny;
      if (depth < 3 && w > baseW * 0.15 && rand() < 0.05 * (0.4 + density * 0.6) / (1 + depth * 0.7)) {
        const side = rand() < 0.5 ? -1 : 1;
        branch(x, y, ang + side * (0.5 + rand() * 0.7), len * (0.3 + rand() * 0.3), w * 0.65, depth + 1, birth);
      }
    }
  }

  let prev = null, travelled = 0;
  for (const p of pts) {
    const x = p[1] * aspect, y = p[2];
    if (prev && prev.s === p[3]) {
      const d = Math.hypot(x - prev.x, y - prev.y);
      if (d > 1e-5 && out.length < MAX_SEGMENTS) {
        const ang = Math.atan2(y - prev.y, x - prev.x);
        out.push([prev.x, prev.y, x, y, baseW, baseW * 0.8, p[0], 0]);
        duration = Math.max(duration, p[0]);
        travelled += d;
        // side roots leave the trunk at a steady rhythm along the line, a little irregular, denser for a higher density
        if (travelled > 0.05 / (0.4 + density * 0.6) * (0.6 + rand() * 0.8)) {
          travelled = 0;
          const side = rand() < 0.5 ? -1 : 1;
          branch(x, y, ang + side * (0.6 + rand() * 0.8), 0.06 + rand() * 0.14, baseW * (0.6 + rand() * 0.3), 1, p[0]);
        }
      }
    }
    prev = { x, y, s: p[3] };
  }
  const segs = new Float32Array(out.length * 8);
  out.forEach((s, i) => segs.set(s, i * 8));
  return { segs, count: out.length, duration };
}
