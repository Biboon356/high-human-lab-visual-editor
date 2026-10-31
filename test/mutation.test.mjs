import test from 'node:test';
import assert from 'node:assert/strict';
import { EFFECTS, EFFECT_PRESETS, instantiatePreset } from '../src/shared/effects-defs.js';
import { ADJUST_LOOKS, ORGANIC_LOOKS, VEIL_LOOKS } from '../src/shared/adjust-defs.js';
import { EFFECT_FRAG } from '../src/renderer/engine/shaders.js';
import { rng, toSeed, childSeed, pickWeighted } from '../src/shared/mutation/rng.js';
import { EFFECT_META, checkMeta, addableTypes, mutationRange, isHeavy } from '../src/shared/mutation/effect-meta.js';
import { validateChain, composeChain, newItem, effectsToChain, chainToEffects, fixParam, MAX_CHAIN } from '../src/shared/mutation/chain.js';
import { mutate, generate, variations } from '../src/shared/mutation/mutate.js';
import { planAdlibs } from '../src/shared/adlibs.js';

const LOOKS = [...EFFECT_PRESETS, ...ADJUST_LOOKS, ...ORGANIC_LOOKS, ...VEIL_LOOKS];
const lookChain = (l) => effectsToChain(instantiatePreset(l));
const types = (c) => c.map((x) => x.type);

test('rng: same seed gives the same sequence, strings hash, children differ', () => {
  const a = rng(42), b = rng(42), c = rng(43);
  const sa = [a(), a(), a(), a()], sb = [b(), b(), b(), b()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, [c(), c(), c(), c()]);
  assert.ok(sa.every((v) => v >= 0 && v < 1));
  assert.equal(toSeed('hello'), toSeed('hello'));
  assert.notEqual(toSeed('hello'), toSeed('hellp'));
  assert.equal(childSeed(7, 1), childSeed(7, 1));
  assert.notEqual(childSeed(7, 1), childSeed(7, 2));
  assert.equal(pickWeighted(rng(1), [['a', 0], ['b', 0]]), undefined);
  assert.equal(pickWeighted(rng(1), [['a', 0], ['b', 3]]), 'b');
});

test('the ad-lib planner still gives the same result as before the shared rng', () => {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
  const a = planAdlibs(beats, { every: 1, seed: 5 }), b = planAdlibs(beats, { every: 1, seed: 5 });
  assert.deepEqual(a, b);
  assert.equal(a.length, 8);
  // pinned values from the generator before it moved into mutation/rng.js
  assert.deepEqual(a.slice(0, 2).map((x) => [x.word, +x.x.toFixed(4), +x.rotation.toFixed(3)]), PINNED_ADLIBS);
});
const PINNED_ADLIBS = [['uh', 0.144, -9.127], ['ayy', 0.1916, -5.953]];

test('effect meta is complete and consistent with the registry', () => {
  assert.deepEqual(checkMeta(), []);
  for (const t of Object.keys(EFFECTS)) assert.ok(EFFECT_META[t], `${t} has meta`);
  assert.ok(addableTypes().length >= 30);
  for (const t of ['crop', 'mask', 'outline']) assert.ok(!addableTypes().includes(t), `${t} is never added by a roll`);
  const def = EFFECTS.glitch.params.find((d) => d.key === 'amount');
  assert.deepEqual(mutationRange('glitch', def), [0.1, 0.8]);
  assert.deepEqual(mutationRange('glitch', EFFECTS.glitch.params.find((d) => d.key === 'rate')), [3, 24]);
  assert.deepEqual(mutationRange('hud', EFFECTS.hud.params.find((d) => d.key === 'scale')), [0.7, 1.6]);
});

test('fixParam / validateChain repair every kind of bad value and leave sound chains alone', () => {
  const amount = EFFECTS.glitch.params[0];
  assert.deepEqual(fixParam(amount, 5), { value: 1, issue: 'clamped' });
  assert.deepEqual(fixParam(amount, NaN), { value: 0.5, issue: 'not-a-number' });
  assert.deepEqual(fixParam(amount, '0.3'), { value: 0.5, issue: 'not-a-number' });
  assert.equal(fixParam(amount, 0.333).value, 0.33);
  const color = EFFECTS.glints.params.find((d) => d.key === 'tint');
  assert.deepEqual(fixParam(color, '#ABC'), { value: '#aabbcc', issue: 'colour-normalised' });
  assert.equal(fixParam(color, 'red').issue, 'bad-colour');
  const opt = EFFECTS.dither.params.find((d) => d.key === 'palette');
  assert.equal(fixParam(opt, 9).value, 1); assert.equal(fixParam(opt, 1.5).issue, 'bad-option');
  const tog = EFFECTS.color.params.find((d) => d.key === 'invert');
  assert.equal(fixParam(tog, 0.9).value, 1);

  const input = [
    { type: 'glitch', params: { amount: 9, bogus: 1, rate: 'x' } },
    { type: 'nope', params: {} },
    { type: 'bloom', params: {}, keyframes: { intensity: [{ t: 2, v: 5 }, { t: 1, v: -3 }, { t: NaN, v: 1 }], nothing: [{ t: 0, v: 1 }] }, bindings: { radius: { source: 'beat', amount: 7 }, threshold: { source: 'laser', amount: 1 } } },
  ];
  const copy = structuredClone(input);
  const { chain, issues } = validateChain(input);
  assert.deepEqual(input, copy, 'the input is not changed');
  assert.deepEqual(types(chain), ['glitch', 'bloom']);
  assert.equal(chain[0].params.amount, 1); assert.equal(chain[0].params.rate, 12); assert.equal('bogus' in chain[0].params, false);
  assert.deepEqual(chain[1].keyframes.intensity, [{ t: 1, v: 0 }, { t: 2, v: 2 }]);
  assert.deepEqual(chain[1].bindings, { radius: { source: 'beat', amount: 1 } });
  const codes = issues.map((i) => i.code);
  for (const c of ['unknown-effect', 'unknown-param', 'clamped', 'not-a-number', 'bad-key', 'bad-track', 'bad-binding']) assert.ok(codes.includes(c), c);
  assert.equal(validateChain('nope').issues[0].code, 'not-a-chain');

  const long = Array.from({ length: MAX_CHAIN + 4 }, () => newItem('grain'));
  const cut = validateChain(long);
  assert.equal(cut.chain.length, MAX_CHAIN); assert.equal(cut.issues.filter((i) => i.code === 'too-long').length, 1);
});

test('every built-in look is already a sound chain (no repairs needed), and round-trips through clip.effects', () => {
  assert.ok(LOOKS.length >= 90);
  for (const l of LOOKS) {
    const c = lookChain(l);
    const { chain, issues } = validateChain(c);
    assert.deepEqual(issues, [], l.name);
    assert.deepEqual(chain, c.map((x) => ({ ...x })), l.name);
    const back = effectsToChain(chainToEffects(chain));
    assert.deepEqual(back, chain, l.name);
    for (const e of chainToEffects(chain)) { assert.ok(e.id); assert.ok(EFFECT_FRAG[e.type]); }
  }
});

test('composeChain: one per type, alpha/ui effects last, heavy budget, locked slots fixed', () => {
  const it = (t, extra) => ({ ...newItem(t), ...extra });
  let r = composeChain([it('mask'), it('glitch'), it('hud'), it('grain'), it('glitch')]);
  assert.deepEqual(types(r.chain), ['glitch', 'grain', 'mask', 'hud']);
  assert.deepEqual(r.dropped, [{ type: 'glitch', reason: 'duplicate' }]);
  r = composeChain([it('pattern'), it('object3d'), it('veins')], { maxHeavy: 1 });
  assert.deepEqual(types(r.chain), ['pattern', 'veins']); assert.equal(r.dropped[0].reason, 'too-many-heavy');
  r = composeChain([it('torn', { locked: true }), it('glitch'), it('grain')]);
  assert.deepEqual(types(r.chain), ['torn', 'glitch', 'grain'], 'a locked torn edge keeps slot 0');
  r = composeChain([it('grain'), it('glitch'), it('blur'), it('color')], { maxLength: 3 });
  assert.deepEqual(types(r.chain), ['grain', 'glitch', 'blur']);
  assert.equal(composeChain([it('glitch'), it('glitch')], { allowDuplicates: true }).chain.length, 2);
});

test('mutate is reproducible: the same seed gives the same chain, different seeds give different ones', () => {
  const base = lookChain(ADJUST_LOOKS.find((l) => l.name === 'Digicam 2002'));
  const a = mutate(base, { seed: 123, strength: 0.6 }), b = mutate(base, { seed: 123, strength: 0.6 });
  assert.deepEqual(a, b);
  const distinct = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(mutate(base, { seed: i, strength: 0.6 }).chain)));
  assert.ok(distinct.size >= 38, `40 seeds give ${distinct.size} different chains`);
  assert.throws(() => mutate(base, {}), /seed/);
  assert.deepEqual(mutate(base, { seed: 'my seed' }), mutate(base, { seed: 'my seed' }), 'string seeds work');
});

test('mutate never changes the base, and strength 0 changes nothing', () => {
  const base = lookChain(ADJUST_LOOKS.find((l) => l.name === 'Cyber CRT'));
  const copy = structuredClone(base);
  mutate(base, { seed: 5, strength: 1 });
  assert.deepEqual(base, copy);
  for (let s = 0; s < 25; s++) assert.deepEqual(mutate(base, { seed: s, strength: 0 }).chain, validateChain(base).chain);
  assert.equal(mutate(base, { seed: 5, strength: 0 }).report.changed.length, 0);
  assert.ok(mutate(base, { seed: 5, strength: 1 }).report.changed.length > 0);
});

test('locks: a locked effect keeps its place and values; locked and fixed parameters and keyframed parameters stay put', () => {
  const base = [
    { ...newItem('glitch'), locked: true },
    { ...newItem('color'), lockedParams: ['hue', 'contrast'] },
    { ...newItem('bloom'), keyframes: { intensity: [{ t: 0, v: 0.2 }, { t: 2, v: 1 }] } },
    newItem('grain'),
  ];
  const ref = validateChain(base).chain;
  let touchedColour = false;
  for (let s = 0; s < 300; s++) {
    const { chain } = mutate(base, { seed: s, strength: 1, maxLength: 8 });
    assert.deepEqual(chain.find((c) => c.type === 'glitch'), ref[0], 'locked glitch is untouched');
    assert.equal(chain.filter((c) => c.type === 'glitch').length, 1, 'and is never removed or duplicated');
    const col = chain.find((c) => c.type === 'color');
    if (col) { assert.equal(col.params.hue, ref[1].params.hue); assert.equal(col.params.contrast, ref[1].params.contrast); assert.equal(col.params.invert, 0, 'invert is fixed'); if (col.params.saturation !== ref[1].params.saturation) touchedColour = true; }
    const bl = chain.find((c) => c.type === 'bloom');
    if (bl) assert.equal(bl.params.intensity, ref[2].params.intensity, 'a keyframed parameter is not re-rolled');
  }
  assert.ok(touchedColour, 'unlocked parameters of the same effect do change');

  // two locked effects never change order relative to each other, whatever is added, removed or swapped around them
  const two = [{ ...newItem('glitch'), locked: true }, newItem('grain'), newItem('blur'), { ...newItem('vhs'), locked: true }];
  for (let s = 0; s < 300; s++) {
    const t = types(mutate(two, { seed: s, strength: 1, maxLength: 8 }).chain);
    assert.ok(t.indexOf('glitch') >= 0 && t.indexOf('vhs') > t.indexOf('glitch'), `glitch stays before vhs: ${t}`);
  }
});

test('every roll is valid and within safe ranges: 600 rolls, all strengths, from empty and from real looks', () => {
  const bases = [[], ...LOOKS.filter((_, i) => i % 6 === 0).map(lookChain)];
  let rolls = 0;
  for (const base of bases) for (const strength of [0.2, 0.6, 1]) for (let s = 0; s < 8; s++) {
    const seed = s * 97 + Math.round(strength * 10);
    const out = base.length ? mutate(base, { seed, strength }) : generate({ seed, strength });
    rolls++;
    assert.deepEqual(validateChain(out.chain).issues, [], `valid (seed ${seed}, strength ${strength})`);
    assert.ok(out.chain.length >= 1 && out.chain.length <= Math.max(6, base.length));
    const was = new Map(base.map((b) => [b.type, b]));
    for (const e of out.chain) for (const d of EFFECTS[e.type].params) {
      if (!d.options && d.kind !== 'color' && !d.toggle) {
        const [lo, hi] = mutationRange(e.type, d), v = e.params[d.key], old = was.get(e.type)?.params[d.key];
        assert.ok((v >= lo - 1e-9 && v <= hi + 1e-9) || v === old, `${e.type}.${d.key}=${v} outside ${lo}..${hi}`);
      }
    }
  }
  assert.ok(rolls >= 300);
});

test('rolls respect the budget and the rules of insertion', () => {
  const seen = new Set();
  for (let s = 0; s < 400; s++) {
    const { chain } = generate({ seed: s, length: 2 + (s % 5), strength: 1, maxHeavy: 1 });
    for (const t of types(chain)) seen.add(t);
    assert.equal(new Set(types(chain)).size, chain.length, 'no duplicates');
    assert.ok(chain.filter((c) => isHeavy(c.type)).length <= 1, 'at most one heavy effect');
    for (const g of ['binarize', 'scene']) assert.ok(chain.filter((c) => EFFECT_META[c.type].exclusive === g).length <= 1, `one ${g} effect at most`);
    const stages = chain.map((c) => EFFECT_META[c.type].stage);
    const firstEnd = stages.findIndex((x) => x === 'alpha' || x === 'ui');
    if (firstEnd >= 0) assert.ok(stages.slice(firstEnd).every((x) => x === 'alpha' || x === 'ui'), `alpha/ui effects are last: ${stages}`);
  }
  for (const t of ['crop', 'mask', 'outline']) assert.ok(!seen.has(t), `${t} is never rolled in`);
  assert.ok(seen.size >= 25, `400 rolls reach ${seen.size} different effects`);
});

test('a roll keeps the chain the user built: it only trims what it chooses to remove', () => {
  const base = [newItem('pattern'), newItem('object3d'), newItem('glitch'), newItem('grain'), newItem('vhs'), newItem('crt'), newItem('film'), newItem('bloom')];
  for (let s = 0; s < 60; s++) {
    const out = mutate(base, { seed: s, strength: 0.5 });
    assert.equal(out.report.dropped.length, 0, 'nothing dropped by the budget');
    assert.equal(out.chain.length, base.length - out.report.removed.length + out.report.added.length);
  }
});

test('bias steers what gets added', () => {
  const count = (bias) => { let n = 0; for (let s = 0; s < 300; s++) n += types(generate({ seed: s, length: 3, bias, strength: 0.6 }).chain).filter((t) => EFFECT_META[t].tags.includes('vhs') || EFFECT_META[t].category === 'analog').length; return n; };
  assert.ok(count({ analog: 6 }) > count({}) * 1.3, 'analog bias adds clearly more analog effects');
  assert.ok(count({ analog: -1 }) === 0, 'a weight of -1 removes a category');
  const pool = ['grain', 'film', 'crt'];
  for (let s = 0; s < 40; s++) assert.ok(types(generate({ seed: s, pool }).chain).every((t) => pool.includes(t)));
});

test('variations: reproducible, different from each other and from the base', () => {
  const base = lookChain(ADJUST_LOOKS.find((l) => l.name === 'Mall Tape'));
  const a = variations(base, { seed: 11, count: 6, strength: 0.5 }), b = variations(base, { seed: 11, count: 6, strength: 0.5 });
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map((v) => JSON.stringify(v.chain))).size, 6);
  assert.ok(a.every((v) => JSON.stringify(v.chain) !== JSON.stringify(validateChain(base).chain)));
  assert.equal(new Set(a.map((v) => v.seed)).size, 6);
  // any single variation can be reproduced on its own from its seed
  assert.deepEqual(mutate(base, { seed: a[3].seed, strength: 0.5 }).chain, a[3].chain);
  assert.equal(variations([], { seed: 3, count: 4 }).length, 4);
  assert.throws(() => variations(base, { count: 2 }), /seed/);
});

test('applying a roll: chainToEffects gives fresh instances with ids, known types and shaders', () => {
  const { chain } = generate({ seed: 77, length: 4 });
  const effects = chainToEffects(chain);
  assert.equal(effects.length, chain.length);
  assert.equal(new Set(effects.map((e) => e.id)).size, effects.length);
  for (const e of effects) { assert.ok(EFFECTS[e.type] && EFFECT_FRAG[e.type]); assert.equal(e.enabled, true); }
});

test('wet / dry: validated, snapped, animatable, carried through clip.effects, and absent means 1', () => {
  const { chain, issues } = validateChain([
    { ...newItem('glitch'), wet: 0.456 }, { ...newItem('grain'), wet: 1.7 }, { ...newItem('crt'), wet: 'x' },
    { ...newItem('vhs'), keyframes: { wet: [{ t: 2, v: 0.2 }, { t: 0, v: 3 }] }, bindings: { wet: { source: 'beat', amount: 0.5 } }, lockedParams: ['wet', 'nope'] },
  ]);
  assert.equal(chain[0].wet, 0.46);
  assert.equal('wet' in chain[1], false, 'wet 1 is the same as absent');
  assert.equal('wet' in chain[2], false);
  assert.deepEqual(chain[3].keyframes.wet, [{ t: 0, v: 1 }, { t: 2, v: 0.2 }]);
  assert.deepEqual(chain[3].bindings.wet, { source: 'beat', amount: 0.5 });
  assert.deepEqual(chain[3].lockedParams, ['wet']);
  assert.deepEqual(issues.map((i) => i.code).sort(), ['bad-wet', 'clamped', 'clamped'], '0.456 was snapped and 1.7 clamped; "x" was refused');
  const effects = chainToEffects(chain);
  assert.equal(effects[0].wet, 0.46); assert.equal(effects[1].wet, undefined);
  assert.deepEqual(effectsToChain(effects), chain, 'wet survives the round trip');
  assert.equal(newItem('glitch').wet, undefined, 'a fresh effect carries no wet');
});

test('rolls can dial an effect down with wet/dry, but only where that makes sense, inside 0.35..1, and never when locked', () => {
  const seen = { dialled: 0, ownMix: 0, alpha: 0, low: 1 };
  for (let s = 0; s < 400; s++) {
    const { chain } = generate({ seed: s, length: 4, strength: 1 });
    for (const c of chain) if (c.wet !== undefined) {
      seen.dialled++; seen.low = Math.min(seen.low, c.wet);
      if (EFFECTS[c.type].params.some((d) => d.key === 'mix')) seen.ownMix++;
      if (['crop', 'mask', 'outline'].includes(c.type)) seen.alpha++;
      assert.ok(c.wet >= 0.35 && c.wet < 1, `wet ${c.wet}`);
    }
  }
  assert.ok(seen.dialled > 40, `${seen.dialled} dialled-down effects in 400 rolls`);
  assert.equal(seen.ownMix, 0, 'effects with their own Mix are left to it'); assert.equal(seen.alpha, 0);
  assert.ok(seen.low <= 0.5, `it can go well down (${seen.low})`);
  const base = [{ ...newItem('glitch'), wet: 0.8, lockedParams: ['wet'] }, { ...newItem('grain'), keyframes: { wet: [{ t: 0, v: 0.5 }, { t: 1, v: 1 }] } }];
  for (let s = 0; s < 200; s++) {
    const out = mutate(base, { seed: s, strength: 1 });
    assert.equal(out.chain.find((c) => c.type === 'glitch').wet, 0.8);
    assert.equal(out.chain.find((c) => c.type === 'grain').wet, undefined, 'animated wet is not overwritten');
  }
  const dialled = mutate(chainOf3(), { seed: 3, strength: 0 });
  assert.ok(dialled.chain.every((c) => c.wet === undefined || c.wet === 0.9), 'strength 0 leaves wet alone');
  // a change to wet shows up in the report
  let reported = false;
  for (let s = 0; s < 200 && !reported; s++) reported = mutate([newItem('glitch'), newItem('grain')], { seed: s, strength: 1 }).report.changed.some((c) => c.key === 'wet');
  assert.ok(reported);
});
const chainOf3 = () => [{ ...newItem('glitch'), wet: 0.9 }, newItem('grain')];
