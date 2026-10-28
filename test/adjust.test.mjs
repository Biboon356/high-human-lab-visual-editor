import test from 'node:test';
import assert from 'node:assert/strict';
import { ADJUST_LOOKS, createAdjustClip } from '../src/shared/adjust-defs.js';
import { EFFECTS } from '../src/shared/effects-defs.js';
import { EFFECT_FRAG } from '../src/renderer/engine/shaders.js';
import { activeVisualClips, clipKind } from '../src/shared/timeline.js';
import { createProject } from '../src/shared/project.js';

test('every Y2K look builds a chain of known effects with shaders', () => {
  assert.ok(ADJUST_LOOKS.length >= 19);
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
  assert.ok(ORGANIC_LOOKS.length >= 9);
  for (const l of ORGANIC_LOOKS) {
    const c = createAdjustClip(l, 0, 8);
    assert.ok(c.effects.some((e) => ['veins', 'spores', 'cells'].includes(e.type)), `${l.name} uses an organic effect`);
    for (const e of c.effects) assert.ok(EFFECT_FRAG[e.type], `${l.name}: ${e.type}`);
    const v = c.effects.find((e) => e.type === 'veins');
    if (v) assert.ok(v.keyframes.growth || v.params.growth === 1, `${l.name}: veins either grow in or are fully grown`);
  }
  const grown = createAdjustClip(ORGANIC_LOOKS[0], 0, 8).effects[0].keyframes.growth;
  assert.deepEqual(grown.map((k) => k.v), [0, 1]);
});

test('new niche effects: every declared param is read by its shader, option counts match', () => {
  for (const k of ['dither', 'holo', 'kaleido', 'spores', 'cells', 'hud', 'crop', 'object3d', 'grid3d']) {
    assert.ok(EFFECT_FRAG[k], `${k} has a shader`);
    for (const d of EFFECTS[k].params) assert.match(EFFECT_FRAG[k], new RegExp(`u_${d.key}\\b`), `${k}.${d.key}`);
  }
  assert.equal(EFFECTS.dither.params.find((d) => d.key === 'palette').options.length, 5);
  assert.equal(EFFECTS.hud.params.find((d) => d.key === 'style').options.length, 3);
  assert.ok(EFFECTS.veins.params.some((d) => d.key === 'cling'));
  assert.match(EFFECT_FRAG.veins, /u_cling/);
});

test('3D object effect: option lists match the shader branches', () => {
  const p = (k) => EFFECTS.object3d.params.find((d) => d.key === k);
  assert.equal(p('shape').options.length, 6);
  assert.equal(p('material').options.length, 5);
  assert.equal(p('background').options.length, 4);
  assert.equal(EFFECTS.grid3d.params.find((d) => d.key === 'sky').options.length, 2);
});
