import test from 'node:test';
import assert from 'node:assert/strict';
import { frameFeatures, pairFeatures, analyzeFrames, windowStats, poolScaler } from '../src/shared/shot-analysis.js';
import { musicStructure } from '../src/shared/music-structure.js';
import { planCutGrid, planSmartMontage, styleSegments, MONTAGE_STYLES, reframeFor } from '../src/shared/smart-montage.js';

const W = 32, H = 18;
const frame = (fn) => { const a = new Uint8Array(W * H * 3); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a.set(fn(x, y), (y * W + x) * 3); return a; };
const flat = (v) => frame(() => [v, v, v]);
const checker = () => frame((x, y) => ((x + y) % 2 ? [230, 230, 230] : [20, 20, 20]));
const smooth = () => frame((x) => { const v = 90 + x * 3; return [v, v, v]; });
const blob = (cx, bg = 40) => frame((x, y) => (Math.abs(x - cx) < 4 && y > 5 && y < 12 ? [240, 240, 240] : [bg, bg, bg]));
const bars = (shift) => frame((x) => (((x + shift + 64) >> 2) % 2 ? [220, 60, 60] : [30, 30, 140]));

test('frameFeatures: sharp beats smooth, exposure and colour are measured', () => {
  const s = frameFeatures(checker(), W, H), m = frameFeatures(smooth(), W, H);
  assert.ok(s.sharp > m.sharp * 5, `${s.sharp} vs ${m.sharp}`);
  assert.ok(frameFeatures(flat(10), W, H).mean < 0.1 && frameFeatures(flat(250), W, H).mean > 0.9);
  const red = frameFeatures(frame(() => [220, 20, 20]), W, H);
  assert.ok(red.sat > 0.8 && (red.hue < 10 || red.hue > 350), `hue ${red.hue}`);
  assert.equal(frameFeatures(flat(100), W, H).hue, -1, 'grey has no hue');
});

test('pairFeatures: motion amount, where it happens, and global shift', () => {
  const a = frameFeatures(blob(6), W, H), b = frameFeatures(blob(10), W, H);
  const p = pairFeatures(b, a, W, H);
  assert.ok(p.motion > 0.02);
  assert.ok(p.cx > 0.2 && p.cx < 0.5, `action is on the left half: ${p.cx}`);
  assert.equal(pairFeatures(a, a, W, H).motion, 0);
  const s0 = frameFeatures(bars(0), W, H), s2 = frameFeatures(bars(2), W, H);
  assert.equal(Math.abs(pairFeatures(s2, s0, W, H).dx), 2, 'a 2px camera shift is found');
});

test('analyzeFrames: finds scene cuts, not camera motion; windowStats reports shake and cuts', () => {
  const frames = [];
  for (let i = 0; i < 8; i++) frames.push(blob(4 + i)); // moving subject
  for (let i = 0; i < 8; i++) frames.push(frame(() => [200 - i * 2, 60, 60])); // hard cut to a different scene
  const S = analyzeFrames(frames, W, H, 4);
  assert.deepEqual(S.cut.map((c, i) => (c ? i : -1)).filter((i) => i >= 0), [8], 'one cut, at the scene change');
  const w = windowStats(S, 1, 3.5);
  assert.equal(w.cutInside, 1);
  assert.ok(w.focus && w.focus.x > 0 && w.focus.x < 1);
  const jitter = [], steady = [];
  for (let i = 0; i < 12; i++) { jitter.push(bars(i % 2 ? 3 : -3)); steady.push(bars(i)); }
  const sj = windowStats(analyzeFrames(jitter, W, H, 4), 0, 3), ss = windowStats(analyzeFrames(steady, W, H, 4), 0, 3);
  assert.ok(sj.shake > ss.shake + 1, `shaky ${sj.shake} vs steady pan ${ss.shake}`);
});

test('poolScaler: relative to the footage it is given', () => {
  const sc = poolScaler([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(sc(1) === 0 && sc(10) === 1 && Math.abs(sc(5.5) - 0.5) < 0.2);
  assert.equal(poolScaler([])(3), 0.5);
});

// ---- music structure ----
function song({ dur = 40, bpm = 120, plan }) {
  const rate = 60, n = dur * rate, rms = new Float32Array(n), bass = new Float32Array(n), high = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / rate; const e = plan.find(([a, b]) => t >= a && t < b)?.[2] ?? 0.1; rms[i] = e; bass[i] = e * 0.9; high[i] = e * 0.7; }
  const beats = []; for (let t = 0.25; t < dur; t += 60 / bpm) beats.push(t);
  return { rate, duration: dur, rms, bass, high, beats };
}
const PLAN = [[0, 8, 0.15], [8, 16, 0.5], [16, 32, 0.95], [32, 40, 0.12]];

test('musicStructure: calm intro, build, drop on the jump, break/outro at the end', () => {
  const m = musicStructure(song({ plan: PLAN }));
  assert.ok(m.energyAt(3) < 0.35 && m.energyAt(24) > 0.8 && m.energyAt(36) < 0.35);
  assert.equal(m.drops.length, 1);
  assert.ok(Math.abs(m.drops[0] - 16) < 1.2, `drop at ${m.drops[0]}`);
  const labels = m.sections.map((s) => s.label);
  assert.equal(labels[0], 'intro'); assert.ok(labels.includes('drop')); assert.equal(labels.at(-1), 'outro');
  assert.ok(m.sections.every((s, i) => i === 0 || Math.abs(s.start - m.sections[i - 1].end) < 1e-6), 'sections tile the song');
});

test('planCutGrid: slow cuts when calm, fast when full, boundary exactly on the drop, all on beats', () => {
  const a = song({ plan: PLAN }), m = musicStructure(a);
  const g = planCutGrid({ beats: a.beats, total: 40, structure: m });
  const calm = g.filter((s) => s.end <= 8), full = g.filter((s) => s.start >= 18 && s.end <= 31);
  const mean = (xs) => xs.reduce((s, x) => s + (x.end - x.start), 0) / xs.length;
  assert.ok(mean(calm) > mean(full) * 2.5, `calm ${mean(calm)}s vs full ${mean(full)}s per cut`);
  const hero = g.find((s) => s.hero); assert.ok(hero && Math.abs(hero.start - m.drops[0]) < 0.13);
  assert.ok(g.every((s, i) => i === 0 || a.beats.some((b) => Math.abs(b - s.start) < 1e-6) ), 'every cut is on a beat');
  assert.ok(Math.abs(g.at(-1).end - 40) < 1e-6 && g.every((s) => s.end > s.start));
  const wild = planCutGrid({ beats: a.beats, total: 40, structure: m, intensity: 1 }), mild = planCutGrid({ beats: a.beats, total: 40, structure: m, intensity: 0 });
  assert.ok(wild.length > mild.length, 'intensity changes the cut rate');
});

// ---- planner ----
const series = (dur, { sharp, motion, mean = 0.5, cuts = [] }, fps = 4) => {
  const n = Math.round(dur * fps), z = (v) => Array(n).fill(v);
  return { fps, n, w: W, h: H, mean: z(mean), contrast: z(0.2), sharp: z(sharp), sat: z(0.4), hue: z(120), motion: z(motion), cx: z(0.5), cy: z(0.5), dx: z(0), dy: z(0), cut: Array.from({ length: n }, (_, i) => (cuts.includes(i) ? 1 : 0)) };
};
const SOURCES = () => [
  { id: 'calm', kind: 'video', duration: 30, width: 1920, height: 1080, analysis: series(30, { sharp: 0.02, motion: 0.01 }) },
  { id: 'wild', kind: 'video', duration: 30, width: 1920, height: 1080, analysis: series(30, { sharp: 0.08, motion: 0.12 }) },
  { id: 'cut', kind: 'video', duration: 20, width: 1920, height: 1080, analysis: series(20, { sharp: 0.05, motion: 0.06, cuts: [40] }) },
];
const run = (o = {}) => { const a = song({ plan: PLAN }); return { a, ...planSmartMontage({ beats: a.beats, total: 40, structure: musicStructure(a), sources: SOURCES(), seed: 7, ...o }) }; };

test('planSmartMontage: gapless, covers the song, deterministic by seed, different seeds differ', () => {
  const { segments } = run();
  assert.ok(segments.length > 15);
  assert.ok(Math.abs(segments[0].start) < 1e-9 && Math.abs(segments.at(-1).start + segments.at(-1).duration - 40) < 1e-6);
  segments.forEach((s, i) => { if (i) assert.ok(Math.abs(s.start - (segments[i - 1].start + segments[i - 1].duration)) < 1e-6); });
  assert.deepEqual(run().segments, segments);
  assert.notDeepEqual(run({ seed: 99 }).segments.map((s) => s.mediaId + s.in), segments.map((s) => s.mediaId + s.in));
});

test('planSmartMontage: matches shot energy to the music, never straddles a scene cut, avoids repeats and reuse', () => {
  const { segments } = run();
  const calm = segments.filter((s) => s.energy < 0.3), full = segments.filter((s) => s.energy > 0.8);
  const motionOf = { calm: 0.01, cut: 0.06, wild: 0.12 };
  const meanMotion = (xs) => xs.reduce((a, s) => a + motionOf[s.mediaId], 0) / xs.length;
  assert.ok(meanMotion(full) > meanMotion(calm) + 0.03, `shots in full bars move more (${meanMotion(full).toFixed(3)}) than in calm bars (${meanMotion(calm).toFixed(3)})`);
  for (const s of segments.filter((x) => x.mediaId === 'cut')) assert.ok(!(s.in < 10 && s.in + s.duration > 10.3), `no scene cut inside the window ${s.in}..${s.in + s.duration}`);
  let sameNext = 0; segments.forEach((s, i) => { if (i && s.mediaId === segments[i - 1].mediaId) sameNext++; });
  assert.ok(sameNext / segments.length < 0.2, `back-to-back repeats: ${sameNext}`);
  for (const id of ['calm', 'wild', 'cut']) {
    const r = segments.filter((s) => s.mediaId === id).map((s) => [s.in, s.in + s.duration]).sort((a, b) => a[0] - b[0]);
    r.forEach((x, i) => { if (i) assert.ok(x[0] >= r[i - 1][1] - 0.31, `${id} reuses footage: ${JSON.stringify(r)}`); });
  }
});

test('planSmartMontage: hero shot at the drop, explained; stills, short clips and missing analysis do not break it', () => {
  const { segments, summary } = run();
  const hero = segments.find((s) => s.role === 'hero'); assert.ok(hero && Math.abs(hero.start - 16) < 1.3 && /hero/.test(hero.why));
  assert.equal(summary.heroes, 1); assert.ok(summary.sourcesUsed >= 2 && summary.cuts === segments.length);
  const a = song({ plan: PLAN });
  const odd = planSmartMontage({ beats: a.beats, total: 40, structure: musicStructure(a), seed: 3, sources: [
    { id: 'short', kind: 'video', duration: 2, width: 640, height: 360, analysis: null },
    { id: 'still', kind: 'image', duration: 0, width: 800, height: 600, still: { len: 1, sharp: 0.05, contrast: 0.2, sat: 0.4, mean: 0.5, motion: 0, shake: 0, badExposure: 0, cutInside: 0, focus: null, hue: 30 } },
  ] });
  assert.ok(Math.abs(odd.segments.reduce((s, x) => s + x.duration, 0) - 40) < 1e-6, 'still covers the song even with tiny sources');
  assert.deepEqual(planSmartMontage({ beats: [], total: 40, structure: musicStructure(a), sources: SOURCES() }).segments, []);
});

test('styles: one coherent grade, accents only on energetic cuts, transitions follow energy', () => {
  const cin = run({ style: 'cinematic' }).segments;
  assert.ok(cin.every((s) => s.look === 'Halation 35mm'), 'cinematic keeps one grade');
  assert.ok(cin.filter((s) => s.energy < 0.35).every((s) => s.transition === 'none'));
  const hype = run({ style: 'hype' }).segments;
  assert.ok(hype.filter((s) => s.look && s.role !== 'hero').every((s) => s.energy >= 0.65), 'accent looks only when the music is full');
  assert.ok(hype.filter((s) => s.energy < 0.35).every((s) => !s.look && s.transition === 'none'), 'calm parts stay clean');
  assert.ok(hype.some((s) => s.punchIn));
  assert.equal(run({ style: 'clean' }).segments.filter((s) => s.look).length, 0);
  for (const k of Object.keys(MONTAGE_STYLES)) assert.ok(MONTAGE_STYLES[k].label);
});

test('reframeFor: wide source fills a tall canvas and the offset follows the action, clamped to the picture', () => {
  const src = { width: 1920, height: 1080 }, cv = { width: 1080, height: 1920 };
  const mid = reframeFor(src, cv, null); assert.ok(Math.abs(mid.scale - 3.16) < 0.01 && mid.x === 0 && mid.y === 0);
  const left = reframeFor(src, cv, { x: 0.2, y: 0.5 }), right = reframeFor(src, cv, { x: 0.8, y: 0.5 });
  assert.ok(left.x > 0 && right.x < 0 && Math.abs(left.x + right.x) < 1e-9);
  assert.ok(Math.abs(reframeFor(src, cv, { x: 0, y: 0.5 }).x) <= (1920 * (1920 / 1080) / 1080 - 1) / 2 + 1e-6);
  assert.deepEqual(reframeFor({ width: 1080, height: 1920 }, cv, { x: 0.1, y: 0.1 }), { scale: 1, x: 0, y: 0 });
});
