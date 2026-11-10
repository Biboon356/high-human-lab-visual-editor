import test from 'node:test';
import assert from 'node:assert/strict';
import { growthKeysFromEnergy, createLivingLayerClip, traceVoice } from '../src/shared/living/organism.js';
import { createTraceClip } from '../src/shared/living/trace-clip.js';
import { createGesture, beginStroke, addPoint } from '../src/shared/living/gesture.js';
import { deriveProjectDna } from '../src/shared/living/project-dna.js';
import { validateChain, effectsToChain } from '../src/shared/mutation/chain.js';
import { evalTrack } from '../src/shared/keyframes.js';
import { REACTIVE_SOURCES } from '../src/shared/params.js';
import { EFFECTS } from '../src/shared/effects-defs.js';
import { EFFECT_FRAG } from '../src/renderer/engine/shaders.js';

const bars = (energies, len = 2) => energies.map((e, i) => ({ start: i * len, end: (i + 1) * len, energy: e }));
const identity = deriveProjectDna({ bpm: 120, energy: { rms: 0.5, bass: 0.6, mid: 0.4, high: 0.7 }, density: 0.3, motion: 0.4, palette: ['#d94a2b', '#f2b134'], duration: 40 }, { seed: 4 }).identity;

test('growth follows the music: it goes 0 to 1, never backwards, and loud bars advance it faster than quiet ones', () => {
  const k = growthKeysFromEnergy(bars([0.1, 0.1, 1, 1, 0.1, 0.1]), 12);
  assert.equal(k[0].v, 0); assert.equal(k.at(-1).v, 1); assert.equal(k.at(-1).t, 12);
  assert.ok(k.every((p, i) => i === 0 || (p.v >= k[i - 1].v && p.t > k[i - 1].t)), 'monotonic');
  const quiet = evalTrack(k, 4, 0) - evalTrack(k, 0, 0), loud = evalTrack(k, 8, 0) - evalTrack(k, 4, 0);
  assert.ok(loud > quiet * 2.2, `the two loud bars grow it ${(loud / quiet).toFixed(1)}x more than the two quiet ones`);
  assert.equal(growthKeysFromEnergy([], 10), null); assert.equal(growthKeysFromEnergy(bars([0.5]), 0), null); assert.equal(growthKeysFromEnergy(null, 10), null);
  // a clip shorter than the song only uses the bars it covers, and still ends at 1
  const short = growthKeysFromEnergy(bars([0.2, 0.9, 0.9, 0.2]), 5);
  assert.equal(short.at(-1).t, 5); assert.equal(short.at(-1).v, 1);
  assert.ok(growthKeysFromEnergy(bars(Array.from({ length: 200 }, (_, i) => (i % 5) / 5), 1), 200).length <= 48, 'a long song does not make hundreds of keys');
  assert.deepEqual(growthKeysFromEnergy(bars([0.3, 0.8]), 4), growthKeysFromEnergy(bars([0.3, 0.8]), 4));
});

test('the living layer is built from existing effects only, in a sensible order, with valid keyframes and bindings', () => {
  const clip = createLivingLayerClip(identity, { start: 0, duration: 40, bars: bars(Array.from({ length: 20 }, (_, i) => (i % 4) / 4)), seed: 4 });
  assert.equal(clip.type, 'adjust'); assert.equal(clip.duration, 40); assert.match(clip.name, /Living layer/);
  const types = clip.effects.map((e) => e.type);
  assert.deepEqual(types.filter((t) => t !== 'spores'), ['veins', 'memory'], 'veins, then the memory that keeps their stain');
  assert.ok(types.every((t) => EFFECTS[t] && EFFECT_FRAG[t]), 'nothing new: every effect already exists, with its shader');
  const veins = clip.effects[0];
  assert.equal(veins.params.color, identity.palette[0], 'the veins take the first colour of the identity');
  assert.equal(veins.params.thickness, identity.organic.thickness);
  assert.ok(veins.keyframes.growth.length >= 3 && veins.keyframes.growth.at(-1).v === 1, 'growth is keyframed from the music');
  assert.deepEqual(veins.bindings.glow, { source: 'bass', amount: 0.35 }); assert.equal(veins.bindings.flow.source, 'beat');
  for (const e of clip.effects) for (const b of Object.values(e.bindings)) assert.ok(REACTIVE_SOURCES.includes(b.source));
  const memory = clip.effects.at(-1);
  assert.equal(memory.params.mode, 1, 'Stain'); assert.ok(Math.abs(memory.params.length - identity.memory.length) <= 0.025 + 1e-9, 'the identity\'s length, to the slider\'s 0.05 s steps');
  assert.deepEqual(validateChain(effectsToChain(clip.effects)).issues, [], 'the whole layer is a valid chain');
  // without analysed music it still grows (over the identity's own time)
  const quiet = createLivingLayerClip(identity, { duration: 40 });
  assert.deepEqual(quiet.effects[0].keyframes.growth.map((k) => k.v), [0, 1]); assert.equal(quiet.effects[0].keyframes.growth[1].t, Math.min(40, identity.organic.growSeconds));
  // spores only when the identity asks for them
  const noSpores = { ...identity, organic: { ...identity.organic, spores: 0.1 } }, spores = { ...identity, organic: { ...identity.organic, spores: 0.8 } };
  assert.equal(createLivingLayerClip(noSpores, { duration: 10 }).effects.some((e) => e.type === 'spores'), false);
  const sp = createLivingLayerClip(spores, { duration: 10 }).effects.find((e) => e.type === 'spores');
  assert.ok(sp && sp.bindings.speed.source === 'high', 'spores drift with the high end');
  assert.deepEqual(effectsToChain(createLivingLayerClip(identity, { duration: 40, bars: bars([0.2, 0.9]), seed: 4 }).effects).map((c) => c.params), effectsToChain(createLivingLayerClip(identity, { duration: 40, bars: bars([0.2, 0.9]), seed: 4 }).effects).map((c) => c.params), 'same inputs, same layer');
});

test('roots grown from a Human Trace speak with the identity, and listen to the bass', () => {
  const g = createGesture(); beginStroke(g); for (let i = 0; i < 30; i++) addPoint(g, i / 30, 0.2 + i * 0.02, 0.5);
  const voice = { ...identity, organic: { ...identity.organic, thickness: 0.41, density: 4.2, glow: 0.33 } };
  const plain = createTraceClip(g, { mode: 'grow', seed: 3 }), voiced = createTraceClip(g, { mode: 'grow', seed: 3, identity: voice });
  assert.equal(voiced.gen.params.thickness, 0.41); assert.notEqual(plain.gen.params.thickness, voiced.gen.params.thickness);
  assert.equal(voiced.gen.params.density, 4.2); assert.equal(voiced.gen.params.glow, 0.33);
  assert.equal(voiced.gen.params.seed, 3, 'the clip keeps its own seed');
  assert.deepEqual(voiced.gen.bindings, { glow: { source: 'bass', amount: 0.3 } });
  assert.deepEqual(createTraceClip(g, { mode: 'residue' }).gen.bindings, {}, 'a residue line does not');
  assert.deepEqual(traceVoice(null), {});
  assert.ok(traceVoice(identity).glow <= 1);
});
