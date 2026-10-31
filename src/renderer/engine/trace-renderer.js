// Draws a recorded hand gesture (clip.gen.path, see shared/living/trace-clip.js) into a 2D canvas, in the same visual language as the
// root renderer: white tapered lines, a soft green halo, brighter growing tips.
//   residue  the line the hand left. Old parts fade over gen.fade seconds (0 = the mark stays). Faster movement draws thinner.
//   grow     roots grow along the line (shared/roots.js buildRootsAlong); they appear exactly as fast as the hand moved.
// The path keeps its real timing, so a pause in the gesture is a pause in the drawing.
import { buildRootsAlong } from '/shared/roots.js';
import { smoothPath } from '/shared/living/gesture.js';

const geoCache = new WeakMap(); // gen.path object -> { key, geo }; geometry only depends on the path and these few numbers
const curveCache = new WeakMap(); // gen.path object -> { aspect, pts }: the recorded points joined by a smooth curve

function curve(gen, aspect) {
  const hit = curveCache.get(gen.path);
  if (hit && hit.aspect === aspect) return hit.pts;
  const pts = smoothPath(gen.path.pts, { aspect });
  curveCache.set(gen.path, { aspect, pts });
  return pts;
}

function rootGeometry(gen, p, aspect) {
  const key = [p.seed, p.density.toFixed(2), p.distortion.toFixed(2), p.thickness.toFixed(3), aspect.toFixed(3)].join('|');
  const hit = geoCache.get(gen.path);
  if (hit && hit.key === key) return hit.geo;
  const geo = buildRootsAlong(curve(gen, aspect), { seed: p.seed, density: p.density, curve: p.distortion, thickness: p.thickness, aspect });
  geoCache.set(gen.path, { key, geo });
  return geo;
}

const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const palette = (green) => ({
  halo: (a) => `rgba(${Math.round(60 + 140 * (1 - green))},${Math.round(190 + 30 * (1 - green))},${Math.round(110 + 90 * (1 - green))},${a})`,
  tip: `rgba(${Math.round(190 + 65 * (1 - green))},255,${Math.round(210 + 30 * (1 - green))},1)`,
});

/** p: resolved generator params {density, movement, distortion, thickness, glow, green, seed, growth, boil}; t: clip seconds */
export function drawTrace(ctx, W, H, transparent, gen, p, t) {
  ctx.clearRect(0, 0, W, H);
  if (!transparent) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
  if (!gen.path?.pts || gen.path.pts.length < 2) return;
  const S = H, aspect = W / H, col = palette(p.green);
  const pts = curve(gen, aspect);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const tEff = t * Math.max(0, p.growth);
  const boil = p.boil > 0.5 ? Math.floor(t * p.boil) : 0;
  const Tm = p.boil > 0.5 ? boil / p.boil : t;

  if (gen.mode === 'grow') {
    const { segs, count } = rootGeometry(gen, p, aspect);
    const sway = (y, i) => Math.sin(Tm * p.movement * 1.4 + y * 5 + i * 0.002) * 0.003 * (0.4 + p.distortion);
    const jit = (i) => (p.boil > 0.5 ? (hash(i * 3.1 + boil * 7.7) - 0.5) * 0.003 : 0);
    const seg = (o, i) => {
      ctx.beginPath();
      ctx.moveTo((segs[o] + sway(segs[o + 1], i) + jit(i)) * S, (segs[o + 1] + jit(i + 9)) * S);
      ctx.lineTo((segs[o + 2] + sway(segs[o + 3], i) + jit(i)) * S, (segs[o + 3] + jit(i + 9)) * S);
      ctx.stroke();
    };
    if (p.glow > 0.02) {
      ctx.strokeStyle = col.halo(0.13 * p.glow);
      for (let i = 0; i < count; i++) { const o = i * 8; if (segs[o + 6] > tEff) continue; ctx.lineWidth = Math.max(2, segs[o + 4] * S * 3.2); seg(o, i); }
    }
    for (let i = 0; i < count; i++) {
      const o = i * 8, birth = segs[o + 6];
      if (birth > tEff) continue;
      const near = Math.max(0, 1 - (tEff - birth) / 0.18); // the newest growth glows
      ctx.strokeStyle = near > 0.05 ? col.tip : '#ffffff';
      ctx.globalAlpha = 0.6 + 0.4 * Math.min(1, 1.2 - segs[o + 7] * 0.2);
      ctx.lineWidth = Math.max(0.8, segs[o + 4] * S);
      seg(o, i);
    }
    ctx.globalAlpha = 1;
    return;
  }

  // residue: the line itself, point by point, in the order the hand drew it
  const fade = Math.max(0, gen.fade ?? 3);
  const wob = 0.004 * p.distortion * (0.3 + p.movement);
  let sp = null; // hand speed per point, in frame heights per second (cheap enough to redo; paths are short)
  sp = pts.map((q, i) => (i && pts[i - 1][3] === q[3] ? Math.hypot((q[1] - pts[i - 1][1]) * aspect, q[2] - pts[i - 1][2]) / Math.max(1e-3, q[0] - pts[i - 1][0]) : 0));
  const base = Math.max(1.2, p.thickness * 0.05 * S);
  const pass = (haloPass) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (a[3] !== b[3] || b[0] > tEff) continue;
      const age = tEff - b[0], alpha = fade > 0 ? Math.max(0, 1 - age / fade) : 1;
      if (alpha < 0.01) continue;
      const w = base / (1 + 1.6 * Math.min(4, sp[i]));
      const jx = Math.sin(Tm * 2.1 + i * 0.9 + p.seed) * wob, jy = Math.cos(Tm * 1.7 + i * 1.3 + p.seed) * wob;
      ctx.beginPath();
      ctx.moveTo((a[1] * aspect + jx) * S, (a[2] + jy) * S);
      ctx.lineTo((b[1] * aspect + jx) * S, (b[2] + jy) * S);
      if (haloPass) { ctx.strokeStyle = col.halo(0.16 * p.glow * alpha); ctx.lineWidth = Math.max(2, w * 3.4); }
      else { ctx.strokeStyle = age < 0.12 ? col.tip : '#ffffff'; ctx.globalAlpha = 0.35 + 0.65 * alpha; ctx.lineWidth = Math.max(0.8, w); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
  };
  if (p.glow > 0.02) pass(true);
  pass(false);
}
