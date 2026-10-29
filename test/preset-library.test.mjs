import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_LIBRARY, PRESET_CATEGORIES, searchPresets } from '../src/shared/preset-library.js';
import { EFFECTS, instantiatePreset } from '../src/shared/effects-defs.js';
import { REACTIVE_SOURCES } from '../src/shared/params.js';
import { EFFECT_FRAG } from '../src/renderer/engine/shaders.js';

test('the library is large, every preset is a multi-effect chain or a deliberate single, ids are unique', () => {
  assert.ok(PRESET_LIBRARY.length >= 120, `${PRESET_LIBRARY.length} presets`);
  assert.equal(new Set(PRESET_LIBRARY.map((p) => p.id)).size, PRESET_LIBRARY.length);
  const multi = PRESET_LIBRARY.filter((p) => p.chain.length >= 2).length;
  assert.ok(multi / PRESET_LIBRARY.length > 0.9, `most presets combine several effects (${multi})`);
  for (const c of PRESET_CATEGORIES) assert.ok(PRESET_LIBRARY.some((p) => p.category === c), `category ${c} is used`);
  for (const p of PRESET_LIBRARY) assert.ok(PRESET_CATEGORIES.includes(p.category), `${p.name}: unknown category ${p.category}`);
});

test('every effect in every preset exists, has a shader, and every parameter is a real one inside its range', () => {
  for (const p of PRESET_LIBRARY) {
    assert.ok(p.chain.length >= 1 && p.name && p.note !== undefined, p.id);
    for (const e of p.chain) {
      const def = EFFECTS[e.type];
      assert.ok(def, `${p.id}: unknown effect "${e.type}"`);
      assert.ok(EFFECT_FRAG[e.type], `${p.id}: no shader for ${e.type}`);
      for (const [k, v] of Object.entries(e.params || {})) {
        const d = def.params.find((x) => x.key === k);
        assert.ok(d, `${p.id}: ${e.type} has no parameter "${k}"`);
        if (d.kind === 'color') assert.match(String(v), /^#[0-9a-f]{6}$/i, `${p.id}: ${e.type}.${k} colour`);
        else if (d.options) assert.ok(Number.isInteger(v) && v >= 0 && v < d.options.length, `${p.id}: ${e.type}.${k} option ${v}`);
        else assert.ok(v >= d.min - 1e-9 && v <= d.max + 1e-9, `${p.id}: ${e.type}.${k}=${v} outside ${d.min}..${d.max}`);
      }
      for (const [k, b] of Object.entries(e.bindings || {})) {
        assert.ok(def.params.some((x) => x.key === k && !x.options && x.kind !== 'color'), `${p.id}: cannot bind ${e.type}.${k}`);
        assert.ok(REACTIVE_SOURCES.includes(b.source), `${p.id}: source ${b.source}`);
        assert.ok(b.amount > 0 && b.amount <= 2, `${p.id}: amount`);
      }
    }
  }
});

test('instantiating a preset gives fresh, independent effect instances (with growth keys where asked)', () => {
  const p = PRESET_LIBRARY.find((x) => x.id === 'organic/veins-overgrown');
  assert.ok(p, 'organic looks are in the library');
  const a = instantiatePreset(p), b = instantiatePreset(p);
  assert.notEqual(a[0].id, b[0].id);
  a[0].params.density = 99; assert.notEqual(b[0].params.density, 99);
  assert.deepEqual(a.find((e) => e.type === 'veins').keyframes.growth.map((k) => k.v), [0, 1]);
  const beat = PRESET_LIBRARY.find((x) => x.id === 'beat/beat-zoom');
  assert.equal(instantiatePreset(beat)[0].bindings.amount.source, 'beat');
});

test('search: every word must match, category filter works, empty query lists all', () => {
  assert.equal(searchPresets('').length, PRESET_LIBRARY.length);
  const vhs = searchPresets('vhs');
  assert.ok(vhs.length >= 5 && vhs.every((p) => `${p.name} ${p.note} ${p.category} ${p.tags.join(' ')}`.toLowerCase().includes('vhs')));
  assert.ok(searchPresets('chrome sphere').some((p) => p.name === 'Mirror Ball') || searchPresets('chrome sphere').length >= 1);
  assert.ok(searchPresets('', '3D').every((p) => p.category === '3D'));
  assert.equal(searchPresets('zzzzqqq').length, 0);
});

test('fade presets are self-placing single colour layers and the tamed kaleido no longer blows out', () => {
  const fades = PRESET_LIBRARY.filter((p) => p.fade);
  assert.deepEqual(fades.map((p) => p.fade).sort(), ['in', 'out', 'out']);
  for (const p of fades) assert.equal(p.chain.length, 1);
  const kal = PRESET_LIBRARY.find((p) => p.name === 'Lucid Kaleido');
  const bloom = kal.chain.find((e) => e.type === 'bloom');
  assert.ok(bloom.params.threshold >= 0.7 && bloom.params.intensity <= 0.5);
});
