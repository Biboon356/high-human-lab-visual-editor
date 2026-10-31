// Looks at footage the way an editor does: is it sharp, well exposed, steady, moving, where is the action, where are the cuts.
// Pure functions over tiny RGB frames (the main process feeds them from ffmpeg), so the whole thing is unit-testable.
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Single-frame features. @param {Uint8Array} rgb w*h*3 */
export function frameFeatures(rgb, w, h) {
  const n = w * h;
  const luma = new Float32Array(n);
  let sum = 0, sat = 0, hx = 0, hy = 0, hw = 0;
  const hist = new Float32Array(16);
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3] / 255, g = rgb[i * 3 + 1] / 255, b = rgb[i * 3 + 2] / 255;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    luma[i] = l; sum += l; hist[Math.min(15, Math.floor(l * 16))]++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx > 0 ? (mx - mn) / mx : 0;
    sat += s;
    if (s > 0.15 && mx > 0.1) {
      let hue = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
      hue *= 60; const a = (hue * Math.PI) / 180;
      hx += Math.cos(a) * s; hy += Math.sin(a) * s; hw += s;
    }
  }
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) varSum += (luma[i] - mean) ** 2;
  let lap = 0, cnt = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    lap += Math.abs(4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - w] - luma[i + w]); cnt++;
  }
  for (let k = 0; k < 16; k++) hist[k] /= n;
  const hue = hw > 0 ? ((Math.atan2(hy, hx) * 180) / Math.PI + 360) % 360 : -1;
  return { luma, hist, mean, contrast: Math.sqrt(varSum / n), sharp: lap / Math.max(1, cnt), sat: sat / n, hue };
}

/** Motion between two frames: amount, where it happens (0..1 coordinates), and the dominant global shift in pixels. */
export function pairFeatures(cur, prev, w, h) {
  const a = cur.luma, b = prev.luma, n = w * h;
  let sum = 0, cx = 0, cy = 0, cw = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.abs(a[y * w + x] - b[y * w + x]);
    sum += d;
    if (d > 0.06) { cx += (x + 0.5) * d; cy += (y + 0.5) * d; cw += d; }
  }
  let histDiff = 0;
  for (let k = 0; k < 16; k++) histDiff += Math.abs(cur.hist[k] - prev.hist[k]);
  // global translation from 1-D brightness profiles (cheap and robust enough to tell a shaky hand from a moving subject)
  const prof = (f) => { const col = new Float32Array(w), row = new Float32Array(h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f[y * w + x]; col[x] += v / h; row[y] += v / w; } return { col, row }; };
  const pc = prof(a), pp = prof(b);
  const best = (u, v, len) => { let bs = 0, bv = Infinity; for (let s = -4; s <= 4; s++) { let e = 0, m = 0; for (let i = Math.max(0, s); i < Math.min(len, len + s); i++) { e += Math.abs(u[i] - v[i - s]); m++; } e /= Math.max(1, m); if (e < bv) { bv = e; bs = s; } } return bs; };
  return { motion: sum / n, cx: cw > 0 ? cx / cw / w : 0.5, cy: cw > 0 ? cy / cw / h : 0.5, histDiff, dx: best(pc.col, pp.col, w), dy: best(pc.row, pp.row, h) };
}

const median = (arr) => { const s = Array.from(arr).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/**
 * @param {Uint8Array[]} frames rgb frames, all w*h*3
 * @returns series: per-sample arrays at `fps`, plus `cut[i]` = 1 when sample i starts a new shot
 */
export function analyzeFrames(frames, w, h, fps) {
  const n = frames.length;
  const S = { fps, n, w, h, mean: [], contrast: [], sharp: [], sat: [], hue: [], motion: [], cx: [], cy: [], dx: [], dy: [], cut: [] };
  let prev = null;
  const hd = [];
  for (let i = 0; i < n; i++) {
    const f = frameFeatures(frames[i], w, h);
    S.mean.push(f.mean); S.contrast.push(f.contrast); S.sharp.push(f.sharp); S.sat.push(f.sat); S.hue.push(f.hue);
    if (prev) {
      const p = pairFeatures(f, prev, w, h);
      S.motion.push(p.motion); S.cx.push(p.cx); S.cy.push(p.cy); S.dx.push(p.dx); S.dy.push(p.dy); hd.push(p.histDiff);
    } else { S.motion.push(0); S.cx.push(0.5); S.cy.push(0.5); S.dx.push(0); S.dy.push(0); hd.push(0); }
    prev = f;
  }
  // a cut is a brightness-distribution jump well above what this footage normally does
  const med = median(hd), mad = median(hd.map((v) => Math.abs(v - med))) || 0.02;
  const thr = Math.max(0.4, med + 6 * mad);
  for (let i = 0; i < n; i++) S.cut.push(i > 0 && hd[i] > thr ? 1 : 0);
  return S;
}

/** Stats for the window [t0,t1) of a series. Values are raw (normalise across the whole pool before scoring). */
export function windowStats(S, t0, t1) {
  const i0 = Math.max(0, Math.floor(t0 * S.fps)), i1 = Math.min(S.n - 1, Math.max(i0, Math.ceil(t1 * S.fps) - 1));
  const len = i1 - i0 + 1;
  const avg = (a) => { let s = 0; for (let i = i0; i <= i1; i++) s += a[i]; return s / len; };
  let cutInside = 0, cx = 0, cy = 0, cw = 0, jitter = 0, hx = 0, hy = 0, hn = 0, under = 0, over = 0;
  for (let i = i0; i <= i1; i++) {
    if (i > i0 && S.cut[i]) cutInside++;
    cx += S.cx[i] * S.motion[i]; cy += S.cy[i] * S.motion[i]; cw += S.motion[i];
    if (S.hue[i] >= 0) { const a = (S.hue[i] * Math.PI) / 180; hx += Math.cos(a); hy += Math.sin(a); hn++; }
    if (S.mean[i] < 0.12) under++; if (S.mean[i] > 0.9) over++;
    if (i > i0 + 1) jitter += Math.abs(S.dx[i] - S.dx[i - 1]) + Math.abs(S.dy[i] - S.dy[i - 1]);
  }
  return {
    len, sharp: avg(S.sharp), contrast: avg(S.contrast), sat: avg(S.sat), mean: avg(S.mean), motion: avg(S.motion),
    // direction flips of the global shift between samples = hand shake; a steady pan has none
    shake: len > 2 ? jitter / (len - 2) : 0,
    badExposure: (under + over) / len,
    cutInside, focus: cw > 0 ? { x: cx / cw, y: cy / cw } : null,
    hue: hn ? ((Math.atan2(hy, hx) * 180) / Math.PI + 360) % 360 : -1,
  };
}

/** Maps a raw value to 0..1 using the 10th/90th percentile of the pool, so "sharp" means sharp *for this project's footage*. */
export function poolScaler(values) {
  const s = Array.from(values).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return () => 0.5;
  const lo = s[Math.floor(s.length * 0.1)], hi = s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
  const span = hi - lo;
  return span < 1e-9 ? () => 0.5 : (v) => clamp01((v - lo) / span);
}

/** Single still image: same stats with no motion. */
export function stillStats(rgb, w, h) {
  const f = frameFeatures(rgb, w, h);
  return { len: 1, sharp: f.sharp, contrast: f.contrast, sat: f.sat, mean: f.mean, motion: 0, shake: 0, badExposure: f.mean < 0.12 || f.mean > 0.9 ? 1 : 0, cutInside: 0, focus: null, hue: f.hue };
}
