// Draws a root system (see shared/roots.js) into a 2D canvas: white tapered lines, soft green halo, bright growing tips.
import { buildRoots } from '/shared/roots.js';

const cache = new Map(); // geometry only depends on these inputs, so it is built once per combination
function geometry(p, aspect) {
  const key = [p.seed, p.density.toFixed(2), p.distortion.toFixed(2), p.origin, p.thickness.toFixed(3), aspect.toFixed(3)].join('|');
  let g = cache.get(key);
  if (!g) {
    if (cache.size > 12) cache.clear();
    g = buildRoots({ seed: p.seed, density: p.density, curve: p.distortion, aspect, origin: p.origin, thickness: p.thickness });
    cache.set(key, g);
  }
  return g;
}

const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** p: resolved generator params {density, movement, distortion, thickness, glow, green, seed, growth, boil, origin}; t: seconds */
export function drawRoots(ctx, W, H, transparent, p, t) {
  const aspect = W / H;
  const { segs, count } = geometry(p, aspect);
  ctx.clearRect(0, 0, W, H);
  if (!transparent) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
  const boilStep = p.boil > 0.5 ? Math.floor(t * p.boil) : 0;
  const T = p.boil > 0.5 ? boilStep / p.boil : t;
  const sway = (y, i) => Math.sin(T * p.movement * 1.4 + y * 5 + i * 0.002) * 0.004 * (0.4 + p.distortion);
  const jit = (i) => (p.boil > 0.5 ? (hash(i * 3.1 + boilStep * 7.7) - 0.5) * 0.003 : 0);
  const S = H; // frame heights -> pixels
  const green = p.green, front = 0.045;
  const tipCol = `rgba(${Math.round(190 + 65 * (1 - green))},255,${Math.round(210 + 30 * (1 - green))},1)`;
  ctx.lineCap = 'round';

  // pass 1: halo
  if (p.glow > 0.02) {
    ctx.strokeStyle = `rgba(${Math.round(60 + 140 * (1 - green))},${Math.round(190 + 30 * (1 - green))},${Math.round(110 + 90 * (1 - green))},${0.13 * p.glow})`;
    for (let i = 0; i < count; i++) {
      const o = i * 8; if (segs[o + 6] > p.growth) continue;
      ctx.lineWidth = Math.max(2, segs[o + 4] * S * 3.2);
      ctx.beginPath();
      ctx.moveTo((segs[o] + sway(segs[o + 1], i) + jit(i)) * S, (segs[o + 1] + jit(i + 9)) * S);
      ctx.lineTo((segs[o + 2] + sway(segs[o + 3], i) + jit(i)) * S, (segs[o + 3] + jit(i + 9)) * S);
      ctx.stroke();
    }
  }
  // pass 2: core lines; segments near the growth front are brighter and slightly fatter
  for (let i = 0; i < count; i++) {
    const o = i * 8, birth = segs[o + 6];
    if (birth > p.growth) continue;
    const near = p.growth < 0.999 ? Math.max(0, 1 - (p.growth - birth) / front) : 0;
    ctx.strokeStyle = near > 0.02 ? tipCol : '#ffffff';
    ctx.globalAlpha = 0.55 + 0.45 * Math.min(1, 1.2 - segs[o + 7] * 0.15) + near * 0.0;
    ctx.lineWidth = Math.max(0.8, (segs[o + 4] + near * 0.0025) * S);
    ctx.beginPath();
    ctx.moveTo((segs[o] + sway(segs[o + 1], i) + jit(i)) * S, (segs[o + 1] + jit(i + 9)) * S);
    ctx.lineTo((segs[o + 2] + sway(segs[o + 3], i) + jit(i)) * S, (segs[o + 3] + jit(i + 9)) * S);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
