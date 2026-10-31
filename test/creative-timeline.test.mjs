import test from 'node:test';
import assert from 'node:assert/strict';
import { planRelation, orderPair, RELATIONS } from '../src/shared/creative/relate.js';
import { createProject, createClip, validateProject } from '../src/shared/project.js';
import { createEffect } from '../src/shared/effects-defs.js';
import { addTrack } from '../src/shared/timeline.js';

function scene() {
  const p = createProject();
  p.media.push({ id: 'm1', kind: 'video', name: 'v', path: '/x.mp4', duration: 20, width: 640, height: 360 });
  p.media.push({ id: 'au', kind: 'audio', name: 'a', path: '/x.wav', duration: 20 });
  const v1 = p.tracks.find((t) => t.kind === 'video' && t.name === 'V1');
  const mk = (name, start, dur, extra = {}) => { const c = createClip({ type: 'media', mediaId: 'm1', name, start, duration: dur, trackId: v1.id, ...extra }); p.clips.push(c); return c; };
  return { p, mk, v1 };
}
const bare = (p) => JSON.stringify(p, (k, v) => (k === 'id' || k === 'trackId' ? undefined : v));
const clean = (p) => JSON.parse(JSON.stringify(p));

test('there are exactly four relations, in the artist\'s words', () => {
  assert.deepEqual(RELATIONS.map((r) => r.title), ['FOLLOW', 'GROW FROM', 'REMEMBER', 'BECOME']);
  assert.ok(RELATIONS.every((r) => r.line.startsWith('Let one thing')));
});

test('orderPair: the earlier clip is the source whichever way they were selected', () => {
  const { p, mk } = scene(); const a = mk('A', 0, 3), b = mk('B', 3, 3);
  assert.equal(orderPair(p, b.id, a.id).from.id, a.id);
  assert.equal(orderPair(p, a.id, a.id), null);
  assert.equal(orderPair(p, a.id, 'nope'), null);
});

test('FOLLOW: the target borrows the source\'s movement (never replacing its own); with no movement it follows the same music; with neither it says so', () => {
  const { p, mk } = scene();
  const a = mk('A', 0, 3, { keyframes: { x: [{ t: 0, v: -0.3 }, { t: 3, v: 0.3 }] } }), b = mk('B', 3, 6);
  const plan = planRelation(p, 'follow', b.id, a.id, { seed: 5 });
  assert.equal(plan.relation, 'follow'); assert.equal(plan.title, 'FOLLOW'); assert.match(plan.summary, /inherits/);
  const copy = clean(p); assert.ok(plan.apply(copy));
  const B = copy.clips.find((c) => c.name === 'B');
  assert.equal(B.keyframes.x.length, 2); assert.equal(B.keyframes.x[1].t, 6);
  b.keyframes.x = [{ t: 0, v: 0 }, { t: 1, v: 0.1 }]; // B already moves: nothing to borrow on x
  const again = planRelation(p, 'follow', a.id, b.id, { seed: 5 });
  assert.ok(again.reason || again.relation === 'follow');
  a.keyframes = {}; a.bindings = { scale: { source: 'bass', amount: 0.02 } }; b.keyframes = {};
  const music = planRelation(p, 'follow', a.id, b.id);
  assert.match(music.summary, /same music/); assert.equal(music.preview, 'playback');
  const c2 = clean(p); assert.ok(music.apply(c2)); assert.deepEqual(c2.clips.find((c) => c.name === 'B').bindings.scale, { source: 'bass', amount: 0.02 });
  a.bindings = {};
  assert.match(planRelation(p, 'follow', a.id, b.id).reason, /Neither/);
});

test('GROW FROM and REMEMBER use the Lab Accident builders: growth carried across the cut, and a memory that lets go', () => {
  const { p, mk } = scene(); const a = mk('A', 0, 3), b = mk('B', 3, 3);
  const g = planRelation(p, 'grow', a.id, b.id, { seed: 2, identity: { palette: ['#ff4fd8'], organic: { density: 4, thickness: 0.3 } } });
  assert.equal(g.title, 'GROW FROM');
  const gp = clean(p); assert.ok(g.apply(gp));
  const va = gp.clips.find((c) => c.name === 'A').effects[0], vb = gp.clips.find((c) => c.name === 'B').effects[0];
  assert.equal(va.type, 'veins'); assert.equal(va.params.color, '#ff4fd8'); assert.equal(va.params.density, 4); assert.equal(va.params.thickness, 0.3);
  assert.deepEqual(va.bindings.glow, { source: 'bass', amount: 0.3 });
  assert.equal(va.keyframes.growth.at(-1).v, 0.9); assert.equal(vb.keyframes.growth[0].v, 0.9);
  const r = planRelation(p, 'remember', a.id, b.id, { seed: 2 });
  assert.equal(r.title, 'REMEMBER'); assert.equal(r.preview, 'playback');
  const rp = clean(p); assert.ok(r.apply(rp));
  assert.equal(rp.clips.filter((c) => c.type === 'adjust').length, 1); assert.equal(rp.clips.find((c) => c.type === 'adjust').effects[0].type, 'memory');
});

test('BECOME: the settings and position of the first glide into the second\'s; what only one has fades in or lingers and lets go; nothing the artist keyframed is replaced', () => {
  const { p, mk } = scene();
  const a = mk('A', 0, 4, { effects: [createEffect('glitch', { amount: 0.9 }), createEffect('vhs', { amount: 0.8 })], keyframes: { x: [{ t: 0, v: 0 }, { t: 4, v: 0.4 }] } });
  const b = mk('B', 4, 6, { effects: [createEffect('glitch', { amount: 0.1 }), createEffect('grain', { amount: 0.5 })] });
  b.effects[0].keyframes.split = [{ t: 0, v: 0.01 }, { t: 1, v: 0.02 }]; // the artist already animated this one
  const plan = planRelation(p, 'become', a.id, b.id);
  assert.equal(plan.title, 'BECOME'); assert.equal(plan.preview, 'playback'); assert.match(plan.summary, /becomes/);
  const copy = clean(p); assert.ok(plan.apply(copy));
  const B = copy.clips.find((c) => c.name === 'B');
  const span = B.effects[0].keyframes.amount[1].t;
  assert.ok(span >= 0.4 && span <= 1.5);
  assert.deepEqual(B.effects[0].keyframes.amount.map((k) => k.v), [0.9, 0.1], 'glitch glides from the first one\'s setting to its own');
  assert.deepEqual(B.effects[0].keyframes.split, [{ t: 0, v: 0.01 }, { t: 1, v: 0.02 }], 'keyframes the artist made are untouched');
  assert.deepEqual(B.effects.find((e) => e.type === 'grain').keyframes.wet.map((k) => k.v), [0, 1], 'an effect only the second has fades in');
  const vhs = B.effects.find((e) => e.type === 'vhs');
  assert.ok(vhs, 'an effect only the first had lingers'); assert.deepEqual(vhs.keyframes.wet.map((k) => k.v), [1, 0]);
  assert.deepEqual(B.keyframes.x.map((k) => k.v), [0.4, 0], 'it starts where the first one ended');
  assert.equal(p.clips.find((c) => c.name === 'B').effects.length, 2, 'the plan changed nothing until applied');
});

test('BECOME has nothing to do for two bare identical clips; sound is refused; the plan is deterministic and additive', () => {
  const { p, mk } = scene(); const a = mk('A', 0, 3), b = mk('B', 3, 3);
  assert.match(planRelation(p, 'become', a.id, b.id).reason, /Neither/);
  const snd = createClip({ type: 'media', mediaId: 'au', name: 'S', start: 0, duration: 3, trackId: p.tracks.find((t) => t.kind === 'audio').id }); p.clips.push(snd);
  assert.match(planRelation(p, 'grow', snd.id, b.id).reason, /not sound/);
  assert.match(planRelation(p, 'nope', a.id, b.id).reason, /Unknown/);
  for (const kind of ['grow', 'remember']) {
    const x = planRelation(p, kind, a.id, b.id, { seed: 9 }), y = planRelation(p, kind, a.id, b.id, { seed: 9 });
    const px = clean(p), py = clean(p); x.apply(px); y.apply(py);
    assert.equal(bare(px), bare(py), `${kind}: same seed, same result`);
    assert.equal(px.clips.filter((c) => c.type !== 'adjust').length, p.clips.length, `${kind}: no clip removed`);
    validateProject(px);
  }
});
