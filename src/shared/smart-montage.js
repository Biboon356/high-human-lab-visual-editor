// Content-aware auto-montage. Pure and deterministic for a given seed.
//   1. the music decides WHERE to cut and how fast (calm bars breathe, full bars and drops cut hard, always on a beat)
//   2. the footage analysis decides WHAT to show (sharp, steady, well exposed, no scene cut inside, motion that matches the music)
//   3. a style decides HOW it looks (one coherent grade, accent looks and transitions reserved for the energetic moments)
import { windowStats, poolScaler } from './shot-analysis.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const hueDist = (a, b) => (a < 0 || b < 0 ? 0.5 : Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) / 180);

/** What each style does at each energy level. Looks are EFFECT_PRESETS names. */
export const MONTAGE_STYLES = {
  hype: { label: 'Hype · punchy', base: null, accents: ['Xerox Photocopy', 'Comic Flash (red/yellow)', 'Acid Halftone', 'Neon Solarize'], accentRate: 0.5, hero: 'Beat Punch (audio)',
    transitions: { hi: ['punch', 'glitch', 'flash'], mid: ['flash', 'punch'], lo: ['none'] }, punch: 1.08, density: 0.1 },
  street: { label: 'Street · xerox / VHS', base: null, accents: ['Xerox Photocopy', 'Halftone Print (B&W)', 'Tour Tape (VHS)', 'Midnight Purple'], accentRate: 0.6, hero: 'Comic Flash (red/yellow)',
    transitions: { hi: ['glitch', 'whip', 'flash'], mid: ['flash', 'none'], lo: ['none'] }, punch: 1.06, density: 0.05 },
  cinematic: { label: 'Cinematic · slow burn', base: 'Halation 35mm', accents: [], accentRate: 0, hero: 'Halation 35mm',
    transitions: { hi: ['punch'], mid: ['dissolve', 'none'], lo: ['dissolve'] }, punch: 1, density: -0.2 },
  y2k: { label: 'Y2K · chrome / digicam', base: null, adjust: 'Digicam 2002', accents: ['Low-Res Rave', 'Tour Tape (VHS)'], accentRate: 0.3, hero: 'Beat Punch (audio)',
    transitions: { hi: ['flash', 'glitch', 'whip'], mid: ['flash', 'none'], lo: ['dissolve'] }, punch: 1.07, density: 0.05 },
  organic: { label: 'Organic · veins grow in', base: null, adjust: 'Veins · Overgrown', accents: [], accentRate: 0, hero: null,
    transitions: { hi: ['punch'], mid: ['dissolve', 'none'], lo: ['dissolve'] }, punch: 1, density: -0.1 },
  clean: { label: 'Clean · no filters', base: null, accents: [], accentRate: 0, hero: null,
    transitions: { hi: ['flash'], mid: ['none'], lo: ['none'] }, punch: 1, density: 0 },
};

/**
 * Cut points on the beat grid, denser where the music is fuller; a boundary always lands exactly on a detected drop.
 * @returns {Array<{start:number,end:number,energy:number,hero:boolean,beats:number}>}
 */
export function planCutGrid({ beats, total, structure, intensity = 0.5, minSegment = 0.3 }) {
  const bs = beats.filter((b) => b > 0.15 && b < total - 0.15);
  const drops = structure.drops || [];
  const bounds = [0];
  while (true) {
    const pos = bounds.at(-1);
    const e = structure.energyAt(pos + 0.01);
    const eff = clamp01(e + (intensity - 0.5) * 0.6);
    const hero = drops.some((d) => Math.abs(d - pos) < 0.12);
    let n = hero ? 2 : eff >= 0.78 ? 1 : eff >= 0.55 ? 2 : eff >= 0.3 ? 4 : 8;
    const first = bs.findIndex((b) => b > pos + minSegment - 1e-9);
    if (first < 0) break;
    let j = first + n - 1;
    if (j >= bs.length) j = bs.length - 1;
    const nextDrop = drops.find((d) => d > pos + 0.2);
    if (nextDrop !== undefined && bs[j] > nextDrop + 0.12) { const k = bs.findIndex((b) => Math.abs(b - nextDrop) < 0.12); if (k >= first) j = k; }
    bounds.push(bs[j]);
    if (j >= bs.length - 1) break;
  }
  if (total - bounds.at(-1) < minSegment && bounds.length > 1) bounds[bounds.length - 1] = total; else bounds.push(total);
  const segs = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i], end = bounds[i + 1];
    const mid = (start + end) / 2;
    const bt = bs.filter((b) => b >= start - 1e-6 && b < end - 1e-6).length;
    segs.push({ start, end, energy: structure.energyAt(mid), hero: drops.some((d) => Math.abs(d - start) < 0.12), beats: Math.max(1, bt) });
  }
  return segs;
}

/** Picks a shot for every segment. @param sources [{id,kind,duration,analysis?:series, still?:stats, width,height}] */
export function planSmartMontage({ beats, total, structure, sources, style = 'hype', intensity = 0.5, seed = 1, minSegment = 0.3 }) {
  const usable = sources.filter((s) => (s.kind === 'video' || s.kind === 'image') && s.pick !== 'skip');
  if (!usable.length || !(total > 0) || !beats.length) return { segments: [], summary: { cuts: 0 } };
  const st = MONTAGE_STYLES[style] || MONTAGE_STYLES.hype;
  const rand = rng(seed);
  const grid = planCutGrid({ beats, total, structure, intensity: clamp01(intensity + st.density), minSegment });

  // normalise every measure against THIS project's footage
  const statsOf = (src, t0, L) => (src.kind === 'image' ? src.still : src.analysis ? windowStats(src.analysis, t0, t0 + L) : null);
  const pool = { sharp: [], contrast: [], sat: [], motion: [], shake: [] };
  for (const s of usable) {
    const step = s.kind === 'image' ? 1e9 : Math.max(1, s.duration / 40);
    for (let t = 0; t === 0 || t < s.duration - 1; t += step) { const w = statsOf(s, t, Math.min(1.5, s.duration)); if (w) for (const k of Object.keys(pool)) pool[k].push(w[k]); if (s.kind === 'image') break; }
  }
  const N = Object.fromEntries(Object.entries(pool).map(([k, v]) => [k, poolScaler(v)]));

  const used = new Map(usable.map((s) => [s.id, []])), uses = new Map(usable.map((s) => [s.id, 0]));
  const recent = [];
  const overlaps = (id, a, b) => used.get(id).some(([x, y]) => a < y - 0.3 && b > x + 0.3);
  let prevHue = -1;
  const out = [];

  const score = (src, t0, L, remaining, seg, role) => {
    const hero = role === 'hero';
    const w = statsOf(src, t0, L);
    let q = 0.5, mN = 0.5, shakeN = 0, why = [];
    if (w) {
      const expo = 1 - Math.min(1, Math.abs(w.mean - 0.5) / 0.5) ** 2;
      shakeN = N.shake(w.shake);
      q = 0.32 * N.sharp(w.sharp) + 0.18 * N.contrast(w.contrast) + 0.12 * N.sat(w.sat) + 0.18 * expo * (1 - w.badExposure) + 0.2 * (1 - shakeN);
      mN = src.kind === 'image' ? 0.3 : N.motion(w.motion);
      if (N.sharp(w.sharp) > 0.7) why.push('sharp'); if (shakeN < 0.3 && src.kind === 'video') why.push('steady'); if (expo > 0.8) why.push('well exposed');
    }
    const target = clamp01(0.1 + 0.8 * clamp01(seg.energy + (intensity - 0.5) * 0.4));
    let total_ = hero ? 0.75 * q + 0.25 * mN
      : role === 'hook' ? 0.8 * q + 0.2 * mN
      : role === 'outro' ? 0.65 * q + 0.35 * (1 - mN)
      : 0.45 * q + 0.55 * (1 - Math.abs(mN - target));
    if (role === 'cut' && Math.abs(mN - target) < 0.2 && src.kind === 'video') why.push(target > 0.6 ? 'motion fits the energy' : 'calm shot for a calm bar');
    if (w?.cutInside) total_ -= 0.6 * Math.min(1, w.cutInside);
    const r = recent.lastIndexOf(src.id);
    if (r >= 0) { const age = recent.length - 1 - r; total_ -= age === 0 ? 0.5 : age < 3 ? 0.2 : 0; }
    total_ -= 0.1 * uses.get(src.id) + (src.kind === 'image' ? 0.1 * uses.get(src.id) : 0);
    if (L < remaining - 0.05) total_ -= 0.25;
    if (w && prevHue >= 0) { const hd = hueDist(w.hue, prevHue); total_ += seg.energy < 0.4 ? 0.08 * (1 - hd) : 0.05 * hd; }
    if (src.pick === 'star') { total_ += role === 'cut' ? 0.3 : 0.45; why.unshift('your favourite'); }
    if (hero) why.unshift('hero shot at the drop');
    if (role === 'hook') why.unshift('strongest opening shot');
    if (role === 'outro') why.unshift('calm closing shot');
    return { total: total_ + rand() * 0.04, q, stats: w, why };
  };

  grid.forEach((seg, gi) => {
    // the first cut is the hook (best picture we have), the last one lands calm; the drop's hero shot wins over both
    seg.role = seg.hero ? 'hero' : grid.length >= 4 && gi === 0 ? 'hook' : grid.length >= 4 && gi === grid.length - 1 ? 'outro' : 'cut';
    let cursor = seg.start;
    while (seg.end - cursor > 0.12) {
      const remaining = seg.end - cursor;
      let best = null;
      for (const src of usable) {
        if (src.kind === 'image') {
          const c = score(src, 0, remaining, remaining, seg, seg.role);
          if (!best || c.total > best.total) best = { ...c, src, t0: 0, L: remaining };
          continue;
        }
        const L = Math.min(remaining, src.duration);
        if (L < 0.2) continue;
        const span = src.duration - L, step = Math.max(0.5, span / 60);
        for (let t0 = 0; t0 <= span + 1e-6; t0 += step) {
          if (overlaps(src.id, t0, t0 + L)) continue;
          const c = score(src, t0, L, remaining, seg, seg.role);
          if (!best || c.total > best.total) best = { ...c, src, t0, L };
        }
      }
      if (!best) { // every window of every clip is already used: allow re-use of the best remaining material
        for (const src of usable.filter((s) => s.kind === 'video')) { const L = Math.min(remaining, src.duration); const t0 = Math.max(0, Math.floor(rand() * (src.duration - L) * 10) / 10); const c = score(src, t0, L, remaining, seg, seg.role); if (!best || c.total > best.total) best = { ...c, src, t0, L }; }
        if (!best) break;
      }
      const len = Math.min(best.L, remaining);
      const slowmo = seg.hero && best.src.kind === 'video' && best.stats && N.motion(best.stats.motion) > 0.4 ? 0.5 : 0; // only worth stretching when something is actually moving
      out.push({ start: cursor, duration: len, mediaId: best.src.id, in: Math.round(best.t0 * 100) / 100, kind: best.src.kind, energy: seg.energy, role: seg.role, slowmo, luma: best.stats?.mean ?? null, sat: best.stats?.sat ?? null, focus: best.stats?.focus || null, why: best.why.join(', ') || 'best available', score: Math.round(best.total * 100) / 100 });
      used.get(best.src.id).push([best.t0, best.t0 + len]); uses.set(best.src.id, uses.get(best.src.id) + 1);
      recent.push(best.src.id); if (recent.length > 4) recent.shift();
      if (best.stats?.hue >= 0) prevHue = best.stats.hue;
      cursor += len;
    }
  });
  // gapless: a clip shorter than its slot leaves nothing uncovered because the loop above kept filling the slot
  let t = 0;
  for (const s of out) { s.start = t; t += s.duration; }

  styleSegments(out, st, rand);
  matchColour(out);
  const sourcesUsed = new Set(out.map((s) => s.mediaId));
  return {
    segments: out,
    summary: {
      cuts: out.length, sourcesUsed: sourcesUsed.size, sourcesTotal: usable.length, unused: usable.filter((s) => !sourcesUsed.has(s.id)).map((s) => s.id),
      heroes: out.filter((s) => s.role === 'hero').length, hook: out.find((s) => s.role === 'hook') ? 1 : 0, slowmo: out.filter((s) => s.slowmo).length, starred: usable.filter((u) => u.pick === 'star').length, skipped: sources.filter((u) => u.pick === 'skip').length, adjust: st.adjust || null, avgCut: out.length ? total / out.length : 0, sections: structure.sections, drops: structure.drops,
    },
  };
}

/**
 * Evens out exposure and saturation between shots: each shot is nudged toward the median of the cut, only when it is clearly off.
 * Writes `match: {brightness, saturation}` on the segments that need it (a small Colour-effect correction, never a full grade).
 */
export function matchColour(segs) {
  const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const mL = med(segs.map((s) => s.luma)), mS = med(segs.map((s) => s.sat));
  if (mL == null || mS == null || segs.length < 3) return segs;
  for (const s of segs) {
    if (!Number.isFinite(s.luma) || !Number.isFinite(s.sat)) continue;
    const dl = mL - s.luma, ratio = s.sat > 0.02 ? mS / s.sat : 1;
    const brightness = Math.abs(dl) > 0.05 ? Math.max(-0.14, Math.min(0.14, dl * 0.5)) : 0;
    const saturation = Math.abs(ratio - 1) > 0.12 ? Math.max(0.8, Math.min(1.3, 1 + (ratio - 1) * 0.6)) : 1;
    if (brightness || saturation !== 1) s.match = { brightness: Math.round(brightness * 1000) / 1000, saturation: Math.round(saturation * 100) / 100 };
  }
  return segs;
}

/** Coherent look: one base grade, accent looks only on energetic cuts, transitions that follow the energy, punch-in on alternate hits. */
export function styleSegments(segs, st, rand = Math.random) {
  let accentIdx = Math.floor(rand() * 1000), hits = 0;
  segs.forEach((s, i) => {
    const bucket = s.energy >= 0.65 ? 'hi' : s.energy >= 0.35 ? 'mid' : 'lo';
    s.look = st.base;
    if (s.role === 'hero' && st.hero) s.look = st.hero;
    else if (st.accents.length && bucket === 'hi' && rand() < st.accentRate) { s.look = st.accents[accentIdx % st.accents.length]; accentIdx++; }
    const pool = st.transitions[bucket];
    s.transition = i === 0 ? 'none' : s.role === 'hero' ? (pool.find((t) => t === 'glitch' || t === 'punch') || pool[0]) : pool[Math.floor(rand() * pool.length)];
    if (s.kind === 'video' && bucket !== 'lo' && st.punch > 1) { if (hits++ % 2 === 1) s.punchIn = st.punch; }
    if (s.kind === 'image') s.kenBurns = bucket === 'lo' ? 1.12 : 1.18;
  });
  return segs;
}

/** Fill scale (relative to "contain") and an offset that keeps the action in frame when a wide source fills a tall canvas. */
export function reframeFor(src, canvas, focus) {
  if (!src.width || !src.height) return { scale: 1, x: 0, y: 0 };
  const contain = Math.min(canvas.width / src.width, canvas.height / src.height), fill = Math.max(canvas.width / src.width, canvas.height / src.height);
  const scale = fill / contain;
  const rx = (src.width * fill) / canvas.width, ry = (src.height * fill) / canvas.height; // displayed size / canvas size
  const f = focus || { x: 0.5, y: 0.5 };
  const x = rx > 1 ? Math.max(-(rx - 1) / 2, Math.min((rx - 1) / 2, -(f.x - 0.5) * rx)) : 0;
  const y = ry > 1 ? Math.max(-(ry - 1) / 2, Math.min((ry - 1) / 2, (f.y - 0.5) * ry)) : 0;
  return { scale, x, y };
}
