import test from 'node:test';
import assert from 'node:assert/strict';
import { ADJUST_LOOKS, createAdjustClip } from '../src/shared/adjust-defs.js';
import { EFFECTS } from '../src/shared/effects-defs.js';
import { EFFECT_FRAG } from '../src/renderer/engine/shaders.js';
import { activeVisualClips, clipKind } from '../src/shared/timeline.js';
import { createProject } from '../src/shared/project.js';

test('every Y2K look builds a chain of known effects with shaders', () => {
  assert.ok(ADJUST_LOOKS.length >= 6);
  for (const l of ADJUST_LOOKS) {
    const c = createAdjustClip(l, 2, 5);
    assert.equal(c.type, 'adjust');
    assert.equal(c.start, 2);
    assert.ok(c.effects.length >= 1, l.name);
    for (const e of c.effects) {
      assert.ok(EFFECTS[e.type], `${l.name}: unknown effect ${e.type}`);
      assert.ok(EFFECT_FRAG[e.type], `${l.name}: no shader for ${e.type}`);
    }
  }
});

test('glints effect declares params the shader reads', () => {
  const keys = EFFECTS.glints.params.map((p) => p.key);
  for (const k of ['threshold', 'length', 'intensity', 'points', 'rotation', 'twinkle', 'tint']) assert.ok(keys.includes(k), k);
  for (const k of keys) assert.match(EFFECT_FRAG.glints, new RegExp(`u_${k}\\b`), k);
});

test('adjustment layer is a visual clip active over its span', () => {
  const p = createProject();
  const c = createAdjustClip(ADJUST_LOOKS[0], 1, 3);
  c.trackId = p.tracks.find((t) => t.kind === 'video').id;
  p.clips.push(c);
  assert.equal(clipKind(p, c), 'visual');
  assert.equal(activeVisualClips(p, 2).length, 1);
  assert.equal(activeVisualClips(p, 0.5).length, 0);
});

test('veins effect: every shader uniform has a declared param, options in range', () => {
  const defs = EFFECTS.veins.params;
  for (const d of defs) assert.match(EFFECT_FRAG.veins, new RegExp(`u_${d.key}\\b`), d.key);
  const origin = defs.find((d) => d.key === 'origin');
  assert.equal(origin.options.length, 6);
  assert.equal(defs.find((d) => d.key === 'mode').options.length, 4);
});

test('organic looks grow in over time and use the veins effect', async () => {
  const { ORGANIC_LOOKS } = await import('../src/shared/adjust-defs.js');
  assert.ok(ORGANIC_LOOKS.length >= 5);
  for (const l of ORGANIC_LOOKS) {
    const c = createAdjustClip(l, 0, 8);
    const v = c.effects.find((e) => e.type === 'veins');
    assert.ok(v, l.name);
    for (const e of c.effects) assert.ok(EFFECT_FRAG[e.type], `${l.name}: ${e.type}`);
    const animated = v.keyframes.growth || v.params.growth === 1;
    assert.ok(animated, l.name);
  }
  const grown = createAdjustClip(ORGANIC_LOOKS[0], 0, 8).effects[0].keyframes.growth;
  assert.deepEqual(grown.map((k) => k.v), [0, 1]);
});
