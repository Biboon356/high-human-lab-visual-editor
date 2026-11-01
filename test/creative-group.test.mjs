import test from 'node:test';
import assert from 'node:assert/strict';
import { planAccidents } from '../src/shared/living/accident.js';
import { planRelationChain } from '../src/shared/creative/relate.js';
import { captureMemory, applyMemory } from '../src/shared/creative/still-here.js';
import { createProject, createClip, validateProject } from '../src/shared/project.js';
import { createEffect } from '../src/shared/effects-defs.js';

/** Six clips in a row on V1: 0-2, 2-4, 4-6 (a run of three cuts' worth) and 20-22, 22-24, so there are cuts at 2, 4, 22 and 24-ish. */
function row() {
  const p = createProject();
  p.media.push({ id: 'm1', kind: 'video', name: 'v', path: '/x.mp4', duration: 60, width: 640, height: 360 });
  const v1 = p.tracks.find((t) => t.kind === 'video' && t.name === 'V1');
  const mk = (name, start, dur, extra = {}) => { const c = createClip({ type: 'media', mediaId: 'm1', name, start, duration: dur, trackId: v1.id, ...extra }); p.clips.push(c); return c; };
  const c = [mk('A', 0, 2), mk('B', 2, 2), mk('C', 4, 2), mk('D', 20, 2), mk('E', 22, 2)];
  return { p, c, v1 };
}
const bare = (p) => JSON.stringify(p, (k, v) => (k === 'id' || k === 'trackId' ? undefined : v));
const clean = (p) => JSON.parse(JSON.stringify(p));

test('accident at the cursor: only the cuts near the playhead, and nothing when there is none near', () => {
  const { p } = row();
  const near = planAccidents(p, { seed: 1, at: 2.2, kinds: ['memory-cut', 'spread'], count: 2 });
  assert.ok(near.length === 2 && near.every((a) => a.at >= 0.7 && a.at <= 3.7), `only the cut near 2.2 s (${near.map((a) => a.at)})`);
  const far = planAccidents(p, { seed: 1, at: 11, count: 5 });
  assert.deepEqual(far, [], 'a playhead in the middle of nowhere changes nothing');
  const later = planAccidents(p, { seed: 1, at: 22.3, kinds: ['memory-cut'], count: 1 });
  assert.ok(later[0].at >= 21 && later[0].at <= 24, 'the other cuts are used when the playhead is there');
  assert.ok(planAccidents(p, { seed: 1, kinds: ['memory-cut'], count: 1 }).length === 1, 'without a cursor it still works anywhere (the old behaviour)');
});

test('accident on a group: every cut between the selected clips at once, as one accident, additive and deterministic', () => {
  const { p, c } = row();
  const sel = [c[0], c[1], c[2]].map((x) => x.id); // A, B, C: two cuts (at 2 and at 4)
  const [mc] = planAccidents(p, { seed: 4, selection: sel, kinds: ['memory-cut'], count: 1, at: 22 }); // the cursor is far away, but the group decides
  assert.ok(mc && /×2/.test(mc.title), `one accident for both cuts (${mc?.title})`); assert.deepEqual([...new Set(mc.clipIds)].sort(), [...sel].sort());
  const before = bare(p);
  const a = clean(p), b = clean(p);
  assert.ok(mc.apply(a)); mc.apply(b);
  assert.equal(a.clips.filter((x) => x.type === 'adjust').length, 2, 'a memory layer at each cut');
  assert.equal(bare(a), bare(b));
  assert.equal(bare(p), before, 'planning changed nothing');
  assert.equal(a.clips.filter((x) => x.type !== 'adjust').length, p.clips.length, 'no clip removed');
  validateProject(a);
  const [un] = planAccidents(p, { seed: 4, selection: [c[0].id, c[3].id, c[4].id], kinds: ['unstable'], count: 1 });
  const u = clean(p); assert.ok(un.apply(u));
  const bound = u.clips.filter((x) => Object.keys(x.bindings || {}).length);
  assert.equal(bound.length, 3, 'unstable reaches all three selected clips, even though they are far apart');
  assert.ok(new Set(bound.map((x) => Math.sign(Object.values(x.bindings)[0].amount))).size === 2, 'working against each other');
  const none = planAccidents(p, { seed: 4, selection: [c[0].id, c[3].id], kinds: ['memory-cut', 'spread', 'borrow-motion', 'mask-leak'], count: 4 });
  assert.deepEqual(none, [], 'two clips that do not touch have nothing to relate (but unstable would still apply)');
});

test('a chain of three or more clips relates each to the next as one plan', () => {
  const { p, c } = row();
  c[0].keyframes = { x: [{ t: 0, v: -0.3 }, { t: 2, v: 0.3 }] }; c[1].keyframes = { x: [{ t: 0, v: 0 }, { t: 2, v: 0.2 }] };
  const plan = planRelationChain(p, 'grow', [c[2].id, c[0].id, c[1].id], { seed: 2 }); // selected in any order
  assert.equal(plan.relation, 'grow'); assert.match(plan.summary, /3 clips in a chain/);
  const g = clean(p); assert.ok(plan.apply(g));
  const veins = (name) => g.clips.find((x) => x.name === name).effects.filter((e) => e.type === 'veins').length;
  assert.deepEqual([veins('A'), veins('B'), veins('C')], [1, 2, 1], 'the middle clip both receives and passes on');
  const f = planRelationChain(p, 'follow', [c[0].id, c[1].id, c[2].id], { seed: 2 });
  const fp = clean(p); assert.ok(f.apply(fp)); assert.ok(fp.clips.find((x) => x.name === 'C').keyframes.x?.length >= 2, 'C follows B, which now moves like A');
  assert.match(planRelationChain(p, 'follow', [c[2].id]).reason, /two or more/);
  assert.equal(planRelationChain(p, 'remember', [c[0].id, c[1].id]).relation, 'remember', 'two clips give the plain relation');
  const bad = planRelationChain(p, 'become', [c[3].id, c[4].id, c[0].id]);
  assert.ok(bad.reason || bad.apply, 'always an answer');
});

test('BRING BACK goes onto every selected clip; a clip that cannot take it does not stop the others', () => {
  const { p, c } = row();
  c[0].effects = [createEffect('glitch', { amount: 0.8 }), createEffect('grain', { amount: 0.4 })]; c[0].keyframes = { x: [{ t: 0, v: -0.2 }, { t: 2, v: 0.3 }] };
  const look = captureMemory(p, { kind: 'looked', clipIds: [c[0].id] }).memory, mv = captureMemory(p, { kind: 'moved', clipIds: [c[0].id] }).memory;
  const copy = clean(p), ids = [c[1].id, c[2].id, c[3].id];
  const r = applyMemory(copy, look, { clipIds: ids });
  assert.ok(r.ok && /3 clips/.test(r.text), r.text);
  assert.deepEqual(ids.map((id) => copy.clips.find((x) => x.id === id).effects.length), [2, 2, 2]);
  const adj = createClip({ type: 'adjust', name: 'Layer', start: 0, duration: 3, trackId: c[0].trackId }); copy.clips.push(adj);
  const m = applyMemory(copy, mv, { clipIds: [c[1].id, adj.id, c[2].id] });
  assert.ok(m.ok && /1 could not take it/.test(m.text), m.text);
  assert.ok(copy.clips.find((x) => x.id === c[1].id).keyframes.x && copy.clips.find((x) => x.id === c[2].id).keyframes.x && !copy.clips.find((x) => x.id === adj.id).keyframes.x);
  const one = applyMemory(clean(p), look, { clipIds: [c[1].id] });
  assert.match(one.text, /Brought back how it looked onto “B”/, 'one clip keeps the old message');
  c[1].effects = Array.from({ length: 12 }, () => createEffect('grain'));
  assert.match(applyMemory(clean(p), look, { clipIds: [c[1].id] }).reason, /more than 12/);
});
