import test from 'node:test';
import assert from 'node:assert/strict';
import { moveEffect, setEffectEnabled, removeEffect, bindParam, setBindingAmount, unbindParam, bindable, bindableParams } from '../src/shared/graph/edit.js';
import { buildGraph } from '../src/shared/graph/layout.js';
import { createProject, createClip, validateProject } from '../src/shared/project.js';
import { createEffect } from '../src/shared/effects-defs.js';

function scene() {
  const p = createProject();
  p.media.push({ id: 'm1', kind: 'video', name: 'v', path: '/x.mp4', duration: 9, width: 64, height: 36 });
  const c = createClip({ type: 'media', mediaId: 'm1', name: 'A', start: 0, duration: 5, trackId: p.tracks.find((t) => t.kind === 'video').id });
  const g = createEffect('glitch'), r = createEffect('grain'), b = createEffect('bloom');
  c.effects.push(g, r, b); p.clips.push(c);
  return { p, c, g, r, b };
}
const order = (c) => c.effects.map((e) => e.type);

test('reorder: any effect to any place; a non-move or a bad place is refused and changes nothing', () => {
  const { p, c, g, b } = scene();
  assert.equal(moveEffect(p, c.id, g.id, 2), true); assert.deepEqual(order(c), ['grain', 'bloom', 'glitch']);
  assert.equal(moveEffect(p, c.id, b.id, 0), true); assert.deepEqual(order(c), ['bloom', 'grain', 'glitch']);
  const before = JSON.stringify(p);
  for (const bad of [[c.id, g.id, 2], [c.id, g.id, -1], [c.id, g.id, 3], [c.id, g.id, 1.5], [c.id, 'nope', 0], ['nope', g.id, 0]]) assert.equal(moveEffect(p, ...bad), false, JSON.stringify(bad));
  assert.equal(JSON.stringify(p), before);
});

test('switch off / on and remove', () => {
  const { p, c, g, r } = scene();
  assert.equal(setEffectEnabled(p, c.id, g.id, false), true); assert.equal(c.effects[0].enabled, false);
  assert.equal(setEffectEnabled(p, c.id, g.id, false), false, 'already off');
  assert.equal(setEffectEnabled(p, c.id, g.id, true), true);
  assert.equal(removeEffect(p, c.id, r.id), true); assert.deepEqual(order(c), ['glitch', 'bloom']);
  assert.equal(removeEffect(p, c.id, r.id), false);
});

test('binding: the default strength is Tell it\'s "normal" for that parameter; re-pointing keeps the strength; wet/dry and clip properties work', () => {
  const { p, c, g, b } = scene();
  assert.equal(bindParam(p, c.id, g.id, 'amount', 'bass'), true);
  assert.deepEqual(g.bindings.amount, { source: 'bass', amount: 0.5 }, 'a 0..1 knob: half of the range, as before');
  assert.equal(bindParam(p, c.id, g.id, 'amount', 'bass'), false, 'nothing changed');
  assert.equal(bindParam(p, c.id, g.id, 'amount', 'high'), true); assert.deepEqual(g.bindings.amount, { source: 'high', amount: 0.5 });
  assert.equal(setBindingAmount(p, c.id, g.id, 'amount', -0.3), true); assert.equal(bindParam(p, c.id, g.id, 'amount', 'mid'), true); assert.deepEqual(g.bindings.amount, { source: 'mid', amount: -0.3 }, 'strength kept');
  assert.equal(bindParam(p, c.id, b.id, 'intensity', 'beat'), true); assert.equal(b.bindings.intensity.amount, 0.25, 'a wide-range parameter gets a gentler default');
  assert.equal(bindParam(p, c.id, b.id, 'wet', 'rms'), true); assert.equal(b.bindings.wet.amount, 0.5);
  assert.equal(bindParam(p, c.id, 'clip', 'scale', 'bass'), true); assert.ok(Math.abs(c.bindings.scale.amount * 4.95 - 0.25) < 1e-9);
  assert.equal(bindParam(p, c.id, null, 'rotation', 'beat'), true);
});

test('binding refuses what cannot follow music: colours, switches, lists, unknown keys, unknown signals, unknown ids', () => {
  const { p, c, g } = scene();
  const col = createEffect('gradmap'), inv = createEffect('color'); c.effects.push(col, inv);
  const before = JSON.stringify(p);
  for (const a of [[c.id, col.id, 'shadow', 'bass'], [c.id, inv.id, 'invert', 'bass'], [c.id, g.id, 'nonsense', 'bass'], [c.id, g.id, 'amount', 'laser'], [c.id, 'nope', 'amount', 'bass'], ['nope', g.id, 'amount', 'bass'], [c.id, g.id, 'amount', 'bass', NaN]]) assert.equal(bindParam(p, ...a), false, JSON.stringify(a));
  assert.equal(JSON.stringify(p), before);
  assert.equal(bindable(c, col.id, 'shadow'), false); assert.equal(bindable(c, inv.id, 'invert'), false); assert.equal(bindable(c, g.id, 'amount'), true); assert.equal(bindable(null, g.id, 'amount'), false);
});

test('strength is kept between -1 and 1, and a link can be removed', () => {
  const { p, c, g } = scene();
  bindParam(p, c.id, g.id, 'amount', 'bass');
  assert.equal(setBindingAmount(p, c.id, g.id, 'amount', 7), true); assert.equal(g.bindings.amount.amount, 1);
  assert.equal(setBindingAmount(p, c.id, g.id, 'amount', -7), true); assert.equal(g.bindings.amount.amount, -1);
  assert.equal(setBindingAmount(p, c.id, g.id, 'amount', -7), false); assert.equal(setBindingAmount(p, c.id, g.id, 'amount', NaN), false); assert.equal(setBindingAmount(p, c.id, g.id, 'split', 0.2), false, 'no link there');
  assert.equal(bindParam(p, c.id, g.id, 'amount', 'bass', 5), true); assert.equal(g.bindings.amount.amount, 1, 'an explicit strength is clamped too');
  assert.equal(unbindParam(p, c.id, g.id, 'amount'), true); assert.equal(g.bindings.amount, undefined); assert.equal(unbindParam(p, c.id, g.id, 'amount'), false);
});

test('the menu lists exactly the parameters that can follow music; edits keep the project valid and the graph agrees', () => {
  const { p, c, g, r } = scene();
  const keys = bindableParams(c, g.id).map((x) => x.key); assert.ok(keys.includes('amount') && keys.includes('wet') && !keys.includes('nonsense'));
  const gm = createEffect('gradmap'); c.effects.push(gm); assert.ok(!bindableParams(c, gm.id).some((x) => ['shadow', 'mid', 'high'].includes(x.key)), 'no colours in the menu');
  assert.ok(bindableParams(c, 'clip').some((x) => x.key === 'scale')); assert.deepEqual(bindableParams(c, 'nope'), []);
  moveEffect(p, c.id, r.id, 0); bindParam(p, c.id, g.id, 'amount', 'bass'); setEffectEnabled(p, c.id, g.id, false);
  const graph = buildGraph(c);
  assert.deepEqual(graph.nodes.filter((n) => n.kind === 'effect').map((n) => n.type).slice(0, 2), ['grain', 'glitch']);
  assert.equal(graph.edges.filter((e) => e.kind === 'bind').length, 1); assert.equal(graph.nodes.find((n) => n.type === 'glitch').enabled, false);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))) && [], []);
});
