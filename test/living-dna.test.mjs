import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInputs, deriveProjectDna, describeIdentity } from '../src/shared/living/project-dna.js';
import { summariseAudio, cutDensity, paletteFromFootage, collectInputs } from '../src/shared/living/project-inputs.js';
import { cleanIdentity } from '../src/shared/living/identity.js';
import { normalizeDna, reproduceDna, exportDna, parseDnaFile, createDna } from '../src/shared/mutation/dna.js';
import { validateChain } from '../src/shared/mutation/chain.js';
import { addableTypes, EFFECT_META } from '../src/shared/mutation/effect-meta.js';
import { hexToHsl } from '../src/shared/mutation/mutate.js';
import { createProject, createClip, uid } from '../src/shared/project.js';

const BASE = { bpm: 128, energy: { rms: 0.5, bass: 0.6, mid: 0.4, high: 0.5 }, density: 0.4, motion: 0.3, palette: ['#d94a2b', '#f2b134'], duration: 60 };
const calm = { bpm: 72, energy: { rms: 0.15, bass: 0.2, mid: 0.2, high: 0.05 }, density: 0.05, motion: 0.05, palette: ['#2a6f97', '#468faf'], duration: 200 };
const wild = { bpm: 160, energy: { rms: 0.8, bass: 0.9, mid: 0.7, high: 0.9 }, density: 0.9, motion: 0.8, palette: ['#e63946', '#f4a261'], duration: 40 };

test('normalizeInputs rounds, clamps and repairs, so the fingerprint ignores float noise and junk', () => {
  const n = normalizeInputs({ bpm: 127.6, energy: { rms: 0.123456, bass: 5, mid: -1, high: NaN }, density: 0.5004, motion: 'x', palette: ['#ABC', 'red', '#112233'], duration: 59.7, styleBias: { analog: 2.5, bad: NaN, print: -1, organic: 99 }, mutateSeeds: [1.9, NaN, 7] });
  assert.equal(n.bpm, 128); assert.deepEqual(n.energy, { rms: 0.12, bass: 1, mid: 0, high: 0 }); assert.equal(n.density, 0.5); assert.equal(n.motion, 0);
  assert.deepEqual(n.palette, ['#aabbcc', '#112233']); assert.equal(n.duration, 60);
  assert.deepEqual(n.styleBias, { analog: 2.5, organic: 6 }); assert.deepEqual(n.mutateSeeds, [1, 7]);
  assert.equal(normalizeInputs({}).bpm, null);
  assert.deepEqual(normalizeInputs({ energy: { rms: 0.5000001 } }).energy, normalizeInputs({ energy: { rms: 0.4999999 } }).energy);
});

test('Project DNA is deterministic: same inputs and seed, same DNA — different seed or different project, different DNA', () => {
  const a = deriveProjectDna(BASE, { seed: 5 }), b = deriveProjectDna(structuredClone(BASE), { seed: 5 });
  assert.deepEqual(a, b);
  const noisy = structuredClone(BASE); noisy.energy.rms += 1e-7; noisy.bpm = 128.2;
  assert.deepEqual(deriveProjectDna(noisy, { seed: 5 }), a, 'float noise does not change the identity');
  const other = deriveProjectDna(BASE, { seed: 6 });
  assert.notEqual(other.id, a.id); assert.notDeepEqual(other.chain, a.chain);
  assert.notEqual(deriveProjectDna(calm, { seed: 5 }).identity.name + deriveProjectDna(calm, { seed: 5 }).id, a.identity.name + a.id);
  assert.deepEqual(reproduceDna(a).chain, a.chain, 'the signature look reproduces from its recipe'); assert.equal(reproduceDna(a).same, true);
  const copy = structuredClone(BASE); deriveProjectDna(copy, { seed: 1 }); assert.deepEqual(copy, BASE, 'the inputs are not changed');
});

test('it is a normal Mutate DNA with an identity layer: valid chain, kind project, survives save/load and export', () => {
  const dna = deriveProjectDna(BASE, { seed: 5, now: 1700000000000 });
  assert.equal(dna.source.kind, 'project'); assert.ok(dna.tags.includes('project')); assert.equal(dna.createdAt, 1700000000000);
  assert.deepEqual(validateChain(dna.chain).issues, []); assert.equal(dna.chain.length, 3);
  assert.ok(dna.chain.every((c) => addableTypes().includes(c.type)), 'only effects a roll may add');
  assert.ok(!dna.chain.some((c) => EFFECT_META[c.type].cost === 'heavy'), 'no heavy effect in the signature');
  assert.deepEqual(cleanIdentity(dna.identity), dna.identity, 'the identity is already clean');
  const back = normalizeDna(JSON.parse(JSON.stringify(dna))).dna;
  assert.deepEqual(back, dna);
  const file = parseDnaFile(exportDna(dna)).items[0];
  assert.deepEqual(file.identity, dna.identity, 'the identity travels in a .hhdna file');
  assert.equal(createDna({ chain: dna.chain }).dna.identity, undefined, 'an ordinary DNA has none');
  assert.equal(createDna({ chain: dna.chain, identity: { traits: { energy: 9 } } }).dna.identity.traits.energy, 1, 'and a bad one is repaired');
});

test('the identity reflects the project: energy, warmth, grit and calm move the suggestions the way you would expect', () => {
  const a = deriveProjectDna(calm, { seed: 1 }).identity, w = deriveProjectDna(wild, { seed: 1 }).identity;
  assert.ok(w.traits.energy > a.traits.energy + 0.3 && w.traits.grit > a.traits.grit && w.traits.calm < a.traits.calm);
  assert.ok(w.traits.warmth > 0.6 && a.traits.warmth < 0.4, `warm ${w.traits.warmth}, cool ${a.traits.warmth}`);
  assert.ok(w.biases.distort > a.biases.distort && w.biases.print > a.biases.print && a.biases.organic > w.biases.organic);
  assert.ok(w.organic.growSeconds < a.organic.growSeconds, 'a louder project grows faster');
  assert.ok(a.memory.length > w.memory.length, 'a calmer project remembers longer');
  assert.ok(a.trace.smoothing > w.trace.smoothing);
  assert.equal(w.memory.mode, 3, 'dense and fast: Echo'); assert.equal(deriveProjectDna({ ...BASE, motion: 0.7, density: 0.2, bpm: 90 }, { seed: 1 }).identity.memory.mode, 2, 'a lot of movement: Scar');
  assert.equal(deriveProjectDna({ ...BASE, motion: 0.1, density: 0.1, bpm: 90, palette: ['#e63946'] }, { seed: 1 }).identity.memory.mode, 1, 'warm and quiet: Stain');
  // a bias the user already chose is kept and added to
  const lean = deriveProjectDna({ ...calm, styleBias: { print: 4 } }, { seed: 1 }).identity;
  assert.ok(lean.biases.print >= a.biases.print + 3.9);
  assert.ok(describeIdentity(w).length === 4 && describeIdentity(w).every((l) => typeof l === 'string' && l.length > 10));
});

test('a palette is always there: three colours at least, from the footage when there is some', () => {
  const none = deriveProjectDna({ ...BASE, palette: [] }, { seed: 3 }).identity.palette;
  assert.ok(none.length >= 3 && none.every((c) => /^#[0-9a-f]{6}$/.test(c)));
  assert.deepEqual(deriveProjectDna({ ...BASE, palette: [] }, { seed: 3 }).identity.palette, none, 'also deterministic');
  const some = deriveProjectDna(BASE, { seed: 3 }).identity.palette;
  assert.deepEqual(some.slice(0, 2), ['#d94a2b', '#f2b134'], 'the footage colours lead');
  assert.ok(some.length >= 3);
});

test('project inputs: audio summary, cutting density, footage palette and motion', () => {
  assert.deepEqual(summariseAudio(null), { bpm: null, energy: { rms: 0, bass: 0, mid: 0, high: 0 }, beats: 0 });
  const au = summariseAudio({ bpm: 120, rms: [0.2, 0.4], bass: [1, 0], mid: [0.5, 0.5], high: [0, 0.2], beats: [0.5, 1] });
  assert.equal(au.bpm, 120); assert.equal(au.beats, 2); assert.ok(Math.abs(au.energy.rms - 0.3) < 1e-9 && au.energy.bass === 0.5);

  const p = createProject(), v = p.tracks.find((t) => t.kind === 'video');
  assert.equal(cutDensity(p), 0);
  for (let i = 0; i < 20; i++) p.clips.push(createClip({ trackId: v.id, type: 'media', start: i * 3, duration: 3, mediaId: 'm' })); // 20 clips in a minute
  assert.ok(Math.abs(cutDensity(p) - 0.5) < 1e-9, `20 cuts a minute = 0.5 (${cutDensity(p)})`);
  p.clips.push(createClip({ trackId: v.id, type: 'adjust', start: 0, duration: 60 }));
  assert.ok(Math.abs(cutDensity(p) - 0.5) < 1e-9, 'layers are not cuts');

  // footage: mostly red frames, a few blue ones, a little motion
  const frames = (hue, sat, mean, n) => Array.from({ length: n }, () => ({ hue, sat, mean }));
  const mk = (list) => ({ n: list.length, hue: list.map((f) => f.hue), sat: list.map((f) => f.sat), mean: list.map((f) => f.mean), motion: list.map(() => 0.05) });
  const look = paletteFromFootage([{ weight: 10, analysis: mk([...frames(5, 0.8, 0.45, 80), ...frames(220, 0.7, 0.4, 20)]) }]);
  assert.ok(look.palette.length >= 3 && look.palette.length <= 5);
  const [h] = hexToHsl(look.palette[0]); assert.ok(h < 25 || h > 345, `the commonest colour is red (hue ${h.toFixed(0)})`);
  assert.ok(look.motion > 0.3 && look.motion < 0.5, `motion ${look.motion}`);
  assert.ok(paletteFromFootage([{ weight: 1, still: { hue: 120, sat: 0.6, mean: 0.5 } }]).palette.length >= 3);
  assert.ok(paletteFromFootage([]).palette.length >= 2, 'no footage is not a crash');
  assert.deepEqual(paletteFromFootage([{ weight: 3, analysis: mk(frames(5, 0.8, 0.45, 40)) }]), paletteFromFootage([{ weight: 3, analysis: mk(frames(5, 0.8, 0.45, 40)) }]));

  const pj = createProject(); const t = pj.tracks.find((x) => x.kind === 'video');
  pj.clips.push(createClip({ trackId: t.id, type: 'media', mediaId: 'a', start: 0, duration: 30 }), createClip({ trackId: t.id, type: 'media', mediaId: 'b', start: 30, duration: 10 }));
  const inputs = collectInputs({ project: pj, analysis: { bpm: 100, rms: [0.5], bass: [0.5], mid: [0.5], high: [0.5], beats: [] }, footage: { a: { analysis: mk(frames(5, 0.8, 0.45, 50)) }, b: { still: { hue: 220, sat: 0.7, mean: 0.4 } } }, styleBias: { analog: 2 }, mutateSeeds: [3, NaN] });
  assert.equal(inputs.bpm, 100); assert.equal(inputs.duration, 40); assert.deepEqual(inputs.mutateSeeds, [3]); assert.deepEqual(inputs.styleBias, { analog: 2 });
  assert.ok(inputs.palette.length >= 3);
  assert.deepEqual(deriveProjectDna(inputs, { seed: 1 }), deriveProjectDna(structuredClone(inputs), { seed: 1 }));
  assert.ok(uid('x'));
});
