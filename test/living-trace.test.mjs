import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRootsAlong } from '../src/shared/roots.js';
import { createTraceClip, TRACE_MODES } from '../src/shared/living/trace-clip.js';
import { createGesture, beginStroke, addPoint, smoothPath } from '../src/shared/living/gesture.js';
import { paramSlots, findSlot } from '../src/shared/living/slots.js';
import { createClip } from '../src/shared/project.js';
import { createEffect } from '../src/shared/effects-defs.js';
import { createGeneratorClip } from '../src/shared/organic-defs.js';

const stroke = (g, t0, n = 60) => { beginStroke(g); for (let i = 0; i < n; i++) addPoint(g, t0 + i / 30, 0.15 + i * 0.012, 0.5 + 0.2 * Math.sin(i / 8)); };

test('buildRootsAlong: deterministic, grows along the line at the speed of the hand, branches never start before their trunk', () => {
  const g = createGesture(); stroke(g, 0);
  const pts = g.pts;
  const a = buildRootsAlong(pts, { seed: 3, density: 1.2 }), b = buildRootsAlong(pts, { seed: 3, density: 1.2 });
  assert.deepEqual(Array.from(a.segs), Array.from(b.segs));
  assert.notDeepEqual(Array.from(buildRootsAlong(pts, { seed: 4 }).segs), Array.from(a.segs));
  assert.ok(a.count > pts.length, 'trunk plus side roots');
  let trunk = 0, sideEarly = 0;
  for (let i = 0; i < a.count; i++) {
    const o = i * 8, birth = a.segs[o + 6], depth = a.segs[o + 7];
    assert.ok(birth >= 0 && Number.isFinite(birth));
    if (depth === 0) { trunk++; assert.ok(birth <= pts.at(-1)[0] + 1e-3, 'the trunk is born while the hand moves'); }
    if (depth > 0 && birth < 0.03) sideEarly++;
  }
  assert.equal(trunk, pts.length - 1);
  assert.equal(sideEarly, 0, 'side roots leave a trunk that already exists');
  assert.ok(a.duration >= pts.at(-1)[0]);
  assert.equal(buildRootsAlong([], {}).count, 0);
  assert.equal(buildRootsAlong([[0, 0.5, 0.5, 0]], {}).count, 0, 'one point is no line');
  // more density, more side roots
  assert.ok(buildRootsAlong(pts, { seed: 3, density: 3.5 }).count > buildRootsAlong(pts, { seed: 3, density: 0.3 }).count);
});

test('a pause in the gesture is a pause in the roots: birth times follow the point times, not the point count', () => {
  const g = createGesture(); stroke(g, 0, 20); stroke(g, 5, 20); // 20 points, a 4 s rest, 20 points
  const { segs, count } = buildRootsAlong(g.pts, { seed: 1 });
  const trunkBirths = [];
  for (let i = 0; i < count; i++) if (segs[i * 8 + 7] === 0) trunkBirths.push(segs[i * 8 + 6]);
  assert.ok(trunkBirths.some((t) => t < 0.8) && trunkBirths.some((t) => t > 5), 'births at the real times');
  assert.equal(trunkBirths.filter((t) => t > 1 && t < 4.9).length, 0, 'nothing is born during the rest');
});

test('createTraceClip: a generator of style trace that keeps the hand timing relative to its own start', () => {
  const g = createGesture(); stroke(g, 12.5);
  const clip = createTraceClip(g, { mode: 'grow', seed: 9, tail: 2, trackId: 'trk_1' });
  assert.equal(clip.type, 'generator'); assert.equal(clip.gen.style, 'trace'); assert.equal(clip.gen.mode, 'grow'); assert.equal(clip.trackId, 'trk_1');
  assert.equal(clip.start, 12.5);
  assert.equal(clip.gen.path.pts[0][0], 0, 'path time starts at 0 at the clip start');
  assert.ok(Math.abs(clip.duration - ((g.pts.at(-1)[0] - 12.5) + 2)) < 1e-9);
  assert.equal(clip.gen.params.seed, 9); assert.equal(clip.props.blend, 'screen');
  const residue = createTraceClip(g, { mode: 'residue' });
  assert.equal(residue.gen.fade, 3); assert.equal(clip.gen.fade, 0);
  assert.notEqual(residue.gen.params.thickness, undefined);
  assert.throws(() => createTraceClip(g, { mode: 'nope' }), /Unknown trace mode/);
  assert.throws(() => createTraceClip(createGesture(), {}), /no gesture/);
  assert.deepEqual(TRACE_MODES, ['residue', 'grow']);
  // JSON round trip keeps everything (project save/load)
  assert.deepEqual(JSON.parse(JSON.stringify(clip)).gen.path, clip.gen.path);
});

test('paramSlots lists what a hand can steer: clip props, effect numbers (with wet/dry), generator numbers — not colours or menus', () => {
  const clip = createClip({ type: 'media', start: 3, effects: [createEffect('glints'), createEffect('dither')] });
  const slots = paramSlots(clip);
  assert.ok(slots.find((s) => s.id === 'clip.x') && slots.find((s) => s.id === 'clip.scale'));
  assert.ok(slots.find((s) => s.id === 'fx0.intensity'), 'glints intensity');
  assert.ok(slots.find((s) => s.id === 'fx0.wet') && slots.find((s) => s.id === 'fx1.wet'), 'every effect has wet/dry');
  assert.equal(slots.find((s) => s.id === 'fx0.tint'), undefined, 'a colour is not steerable');
  assert.equal(slots.find((s) => s.id === 'fx1.palette'), undefined, 'a menu is not steerable');
  assert.ok(slots.every((s) => s.start === 3 && s.owner && s.def && typeof s.setBase === 'function'));
  const x = findSlot(clip, 'clip.x'); x.setBase(0.3); assert.equal(clip.props.x, 0.3); assert.equal(x.owner, clip);
  const wet = findSlot(clip, 'fx0.wet'); wet.setBase(0.4); assert.equal(clip.effects[0].wet, 0.4); wet.setBase(1); assert.equal('wet' in clip.effects[0], false);
  const fxp = findSlot(clip, 'fx0.intensity'); fxp.setBase(2); assert.equal(clip.effects[0].params.intensity, 2); assert.equal(fxp.owner, clip.effects[0]);
  const gen = createGeneratorClip(undefined, 0, 5);
  const gs = paramSlots(gen);
  assert.ok(gs.find((s) => s.id === 'gen.thickness')); assert.equal(findSlot(gen, 'gen.thickness').owner, gen.gen);
  assert.deepEqual(paramSlots(null), []); assert.equal(findSlot(clip, 'nope'), null);
});

test('smoothPath: a curve through every recorded point, same timing, strokes kept apart, nothing leaves the frame', () => {
  const pts = [[0, 0.1, 0.5, 0], [1, 0.3, 0.2, 0], [2, 0.6, 0.8, 0], [3, 0.9, 0.5, 0], [5, 0.2, 0.2, 1], [6, 0.8, 0.9, 1]];
  const sm = smoothPath(pts);
  assert.ok(sm.length > pts.length * 3, `${pts.length} points became ${sm.length}`);
  for (const p of pts) assert.ok(sm.some((q) => q[0] === p[0] && q[1] === p[1] && q[2] === p[2] && q[3] === p[3]), 'every original point is kept exactly');
  for (let i = 1; i < sm.length; i++) assert.ok(sm[i][0] >= sm[i - 1][0] && (sm[i][3] === sm[i - 1][3] || sm[i][3] === sm[i - 1][3] + 1), 'time and strokes only move forward');
  assert.ok(sm.every((q) => q[1] >= 0 && q[1] <= 1 && q[2] >= 0 && q[2] <= 1));
  assert.equal(sm.filter((q) => q[3] === 0).at(-1)[0], 3, 'stroke one still ends at its last real point');
  assert.ok(sm.filter((q) => q[3] === 1).every((q) => q[0] >= 5), 'no point is invented between the strokes');
  assert.deepEqual(smoothPath(pts), sm, 'deterministic');
  assert.deepEqual(smoothPath([]), []);
  const dense = []; for (let i = 0; i < 100; i++) dense.push([i / 60, 0.2 + i * 0.005, 0.5, 0]);
  assert.equal(smoothPath(dense).length, dense.length, 'an already dense gesture is left alone');
});
