import test from 'node:test';
import assert from 'node:assert/strict';
import { relations, planAccidents, ACCIDENT_KINDS } from '../src/shared/living/accident.js';
import { createProject, createClip, validateProject } from '../src/shared/project.js';
import { addTrack, addClipRaw } from '../src/shared/timeline.js';
import { createEffect } from '../src/shared/effects-defs.js';
import { createMask } from '../src/shared/mask.js';
import { validateChain, effectsToChain } from '../src/shared/mutation/chain.js';
import { REACTIVE_SOURCES } from '../src/shared/params.js';
import { EFFECTS } from '../src/shared/effects-defs.js';

/** A at 0-3 and B at 3-6 on V1 (a cut at 3 s), U on a track above, 1-4 s (it starts inside A and overlaps B). A has motion. */
function scene() {
  const p = createProject();
  p.media.push({ id: 'm1', kind: 'image', name: 'pic', path: '/x.png', duration: 0, width: 640, height: 360 });
  const v1 = p.tracks.find((t) => t.kind === 'video' && t.name === 'V1');
  const mk = (name, start, dur, trackId, extra = {}) => { const c = createClip({ type: 'media', mediaId: 'm1', name, start, duration: dur, trackId, ...extra }); p.clips.push(c); return c; };
  const A = mk('A', 0, 3, v1.id, { keyframes: { x: [{ t: 0, v: -0.3 }, { t: 3, v: 0.3 }], rotation: [{ t: 0, v: -5 }, { t: 3, v: 5 }] } });
  const B = mk('B', 3, 3, v1.id);
  const top = addTrack(p, 'video');
  const U = createClip({ type: 'text', name: 'Title', start: 1, duration: 3, trackId: top.id }); p.clips.push(U);
  return { p, A, B, U };
}
const snapshot = (p) => JSON.stringify(p);
/** New clips, tracks and effects get random ids; two applications of one plan are equal apart from those. */
const bare = (p) => JSON.stringify(p).replace(/\b(clip|trk|fx)_[a-z0-9]+/g, '$1');

test('relations: cuts on a track, overlaps across tracks (upper starts inside lower); hidden tracks, sound and gaps do not count', () => {
  const { p, A, B, U } = scene();
  const rel = relations(p);
  assert.deepEqual(rel.cuts.map((c) => [c.a, c.b, c.at]), [[A.id, B.id, 3]]);
  assert.ok(rel.overlaps.some((o) => o.upper === U.id && o.lower === A.id && o.at === 1 && Math.abs(o.len - 2) < 1e-9));
  assert.equal(rel.overlaps.some((o) => o.upper === U.id && o.lower === B.id), false, 'U starts before B, so it does not start inside it: not that kind of overlap');
  assert.equal(rel.overlaps.some((o) => o.lower === U.id), false, 'the upper clip is never the lower one');
  p.clips.push(createClip({ type: 'media', mediaId: 'm1', start: 10, duration: 2, trackId: A.trackId })); // a gap of 4 s: not a cut
  assert.equal(relations(p).cuts.length, 1);
  p.tracks.find((t) => t.id === U.trackId).hidden = true;
  assert.equal(relations(p).overlaps.length, 0, 'hidden tracks are not on screen');
  assert.deepEqual(relations(createProject()), { clips: [], cuts: [], overlaps: [] });
});

test('planAccidents is deterministic, gives distinct kinds, and plans nothing when there is nothing to relate', () => {
  const { p } = scene();
  const a = planAccidents(p, { seed: 11 }), b = planAccidents(p, { seed: 11 });
  assert.equal(a.length, 3);
  assert.deepEqual(a.map((x) => [x.id, x.kind, x.summary, x.at]), b.map((x) => [x.id, x.kind, x.summary, x.at]));
  assert.equal(new Set(a.map((x) => x.kind)).size, 3, 'three different kinds');
  const clone = (acc) => { const c = structuredClone(p); acc.apply(c); return bare(c); };
  a.forEach((x, i) => assert.equal(clone(x), clone(b[i]), `applying ${x.kind} twice from the same plan gives the same project`));
  assert.notDeepEqual(planAccidents(p, { seed: 12 }).map((x) => x.kind + x.summary), a.map((x) => x.kind + x.summary), 'another seed, other accidents');
  assert.deepEqual(planAccidents(createProject(), { seed: 1 }), []);
  assert.throws(() => planAccidents(p, {}), /seed/);
  const solo = createProject(); solo.clips.push(createClip({ type: 'text', start: 0, duration: 3, trackId: solo.tracks.find((t) => t.kind === 'video').id }));
  assert.deepEqual(planAccidents(solo, { seed: 1 }), [], 'one clip on its own has no relationship to break');
  assert.equal(planAccidents(solo, { seed: 1, selection: [solo.clips[0].id] }).map((x) => x.kind).join(), 'unstable', 'unless it is selected: then it can be made unstable');
  assert.equal(planAccidents(p, { seed: 3, count: 1 }).length, 1);
});

test('every accident only adds: nothing the user made is removed, replaced or overwritten, and the result is still a valid project', () => {
  const { p } = scene();
  p.clips[0].effects.push(createEffect('grain'));
  for (let seed = 1; seed <= 30; seed++) for (const acc of planAccidents(p, { seed, count: 5, selection: [p.clips[1].id] })) {
    const c = structuredClone(p);
    assert.equal(acc.apply(c), true, `${acc.kind} applies`);
    assert.ok(c.clips.length >= p.clips.length, 'no clip is removed');
    for (const before of p.clips) {
      const after = c.clips.find((x) => x.id === before.id);
      assert.deepEqual(after.effects.slice(0, before.effects.length), before.effects, `${acc.kind}: existing effects are kept in place`);
      for (const [k, track] of Object.entries(before.keyframes)) assert.deepEqual(after.keyframes[k], track, `${acc.kind}: existing keyframes on ${k} are untouched`);
      for (const [k, b] of Object.entries(before.bindings)) assert.deepEqual(after.bindings[k], b);
      if (before.mask) assert.deepEqual(after.mask, before.mask);
      assert.deepEqual({ ...after.props, maskFeather: before.props.maskFeather }, before.props, `${acc.kind}: clip properties are untouched (a mask-leak may soften its own mask edge)`);
      assert.equal(after.start, before.start); assert.equal(after.duration, before.duration); assert.equal(after.trackId, before.trackId);
    }
    assert.doesNotThrow(() => validateProject(JSON.parse(JSON.stringify(c))), `${acc.kind}: still a valid project`);
    for (const clip of c.clips) { assert.deepEqual(validateChain(effectsToChain(clip.effects)).issues, [], `${acc.kind}: effects stay valid`); for (const e of clip.effects) assert.ok(EFFECTS[e.type]); for (const b of Object.values(clip.bindings)) assert.ok(REACTIVE_SOURCES.includes(b.source)); }
  }
});

test('each kind does what it says', () => {
  const { p, A, B, U } = scene();
  const one = (kind, extra = {}) => { const [acc] = planAccidents(p, { seed: 5, kinds: [kind], count: 1, ...extra }); assert.ok(acc, kind); const c = structuredClone(p); acc.apply(c); return { acc, c }; };

  const m = one('memory-cut');
  const layer = m.c.clips.find((x) => x.type === 'adjust');
  assert.ok(layer && layer.start < 3 && layer.start + layer.duration > 3, 'an adjustment layer straddles the cut');
  const fx = layer.effects[0]; assert.equal(fx.type, 'memory');
  assert.equal(fx.keyframes.intensity[0].v, 0); assert.equal(fx.keyframes.intensity[1].v, 1); assert.equal(fx.keyframes.intensity.at(-1).v, 0);
  assert.ok(Math.abs(layer.start + fx.keyframes.intensity[1].t - 3) < 1e-6, 'it shows from exactly the cut');
  assert.equal(m.c.tracks.length, p.tracks.length + 1, 'on a track of its own'); assert.equal(m.acc.preview, 'playback');

  const s = one('spread');
  const [va, vb] = [s.c.clips.find((x) => x.id === s.acc.clipIds[0]), s.c.clips.find((x) => x.id === s.acc.clipIds[1])].map((c) => c.effects.find((e) => e.type === 'veins'));
  assert.ok(va && vb && va.params.seed === vb.params.seed && va.params.color === vb.params.color, 'the same veins on both sides');
  assert.ok(va.keyframes.growth.at(-1).v > 0.8 && vb.keyframes.growth[0].v > 0.8 && vb.keyframes.growth.at(-1).v === 0, 'they arrive at the cut and recede after it');
  assert.ok(va.keyframes.growth.every((k) => k.t >= 0));
  const colour = planAccidents(p, { seed: 5, kinds: ['spread'], count: 1, identity: { palette: ['#123456'] } })[0];
  const cc = structuredClone(p); colour.apply(cc);
  assert.equal(cc.clips.find((x) => x.id === colour.clipIds[0]).effects.find((e) => e.type === 'veins').params.color, '#123456', 'the identity palette is used');

  const bm = one('borrow-motion', { selection: [B.id] });
  assert.ok(bm.acc.clipIds[0] === A.id || bm.acc.clipIds[1] === A.id);
  const target = bm.c.clips.find((x) => x.id === bm.acc.clipIds[1]);
  assert.ok(Object.keys(target.keyframes).length >= 1, 'the target gained keyframes from the source');
  for (const k of Object.keys(target.keyframes)) assert.ok(target.keyframes[k].at(-1).t <= target.duration + 1e-9, 'stretched to the target length');
  const noMotion = structuredClone(p); noMotion.clips.find((x) => x.id === A.id).keyframes = {};
  assert.deepEqual(planAccidents(noMotion, { seed: 5, kinds: ['borrow-motion'] }), [], 'no motion anywhere: no such accident');

  const ml = one('mask-leak');
  const up = ml.c.clips.find((x) => x.id === U.id);
  assert.equal(up.mask.shapes[0].k, 'ellipse'); assert.deepEqual(up.keyframes.maskScale.map((k) => k.v), [0.1, 1.6]);
  const masked = structuredClone(p); masked.clips.find((x) => x.id === U.id).mask = createMask('rect');
  assert.deepEqual(planAccidents(masked, { seed: 5, kinds: ['mask-leak'] }), [], 'a mask the user made is never overwritten');

  const un = one('unstable');
  const bound = un.c.clips.filter((c) => Object.keys(c.bindings).length);
  assert.equal(bound.length, 2); const [k] = Object.keys(bound[0].bindings);
  assert.equal(Math.sign(bound[0].bindings[k].amount), -Math.sign(bound[1].bindings[k].amount), 'a pair works against each other');
  assert.equal(un.acc.preview, 'playback');
});

test('accidents are previews until applied: planning changes nothing, and each accident can be applied to a copy', () => {
  const { p } = scene();
  const before = snapshot(p);
  const list = planAccidents(p, { seed: 9, count: 5 });
  assert.ok(list.length >= 4);
  for (const acc of list) { const c = structuredClone(p); acc.apply(c); }
  assert.equal(snapshot(p), before, 'the real project was never touched');
  assert.deepEqual(ACCIDENT_KINDS, ['memory-cut', 'spread', 'borrow-motion', 'mask-leak', 'unstable']);
  // applying to a project where the clips are gone does nothing and says so
  const gone = structuredClone(p); gone.clips = [];
  for (const acc of list) assert.equal(acc.apply(gone), false);
});
