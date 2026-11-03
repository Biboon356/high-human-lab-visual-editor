import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, describeGraph, GEOM, SIGNAL_LABELS } from '../src/shared/graph/layout.js';
import { createProject, createClip } from '../src/shared/project.js';
import { createEffect } from '../src/shared/effects-defs.js';
import { applyPlan } from '../src/shared/vision/plan.js';
import { interpretVision } from '../src/shared/vision/vibes.js';

function scene() {
  const p = createProject();
  p.media.push({ id: 'm1', kind: 'video', name: 'v', path: '/x.mp4', duration: 9, width: 64, height: 36 });
  const c = createClip({ type: 'media', mediaId: 'm1', name: 'Verse A', start: 0, duration: 5, trackId: p.tracks.find((t) => t.kind === 'video').id });
  p.clips.push(c);
  return { p, c };
}

test('no clip: an empty graph that says what to do', () => {
  const g = buildGraph(null);
  assert.equal(g.empty, true); assert.deepEqual(g.nodes, []); assert.match(describeGraph(g), /Select a clip/);
});

test('flow follows the real effect order: clip, each effect, output, with one arrow between neighbours', () => {
  const { c } = scene();
  c.effects.push(createEffect('grain'), createEffect('glitch'), createEffect('bloom'));
  const g = buildGraph(c);
  assert.deepEqual(g.nodes.filter((n) => n.kind !== 'signal').map((n) => n.kind === 'effect' ? n.type : n.kind), ['clip', 'grain', 'glitch', 'bloom', 'out']);
  assert.equal(g.edges.filter((e) => e.kind === 'flow').length, 4);
  const ys = g.nodes.filter((n) => n.kind !== 'signal').map((n) => n.y);
  assert.deepEqual([...ys].sort((a, b) => a - b), ys, 'drawn top to bottom in chain order');
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] >= g.nodes[i - 1].y + g.nodes[i - 1].h, 'no overlap');
});

test('a disabled effect is drawn but marked; an unknown effect type is skipped, never a crash', () => {
  const { c } = scene();
  const a = createEffect('grain'); a.enabled = false; c.effects.push(a, { id: 'x', type: 'made-up', params: {}, bindings: {}, keyframes: {} });
  const g = buildGraph(c);
  assert.equal(g.nodes.find((n) => n.type === 'grain').enabled, false);
  assert.equal(g.nodes.filter((n) => n.kind === 'effect').length, 1);
});

test('audio bindings become wires from a signal box to the exact parameter row; unused signals are not drawn', () => {
  const { c } = scene();
  const gl = createEffect('glitch'); gl.bindings.amount = { source: 'bass', amount: 0.6 }; gl.bindings.split = { source: 'bass', amount: -0.3 };
  const gr = createEffect('grain'); gr.bindings.amount = { source: 'rms', amount: 0.4 };
  c.effects.push(gl, gr); c.bindings.scale = { source: 'beat', amount: 0.5 };
  const g = buildGraph(c);
  const sigs = g.nodes.filter((n) => n.kind === 'signal').map((n) => n.source).sort();
  assert.deepEqual(sigs, ['bass', 'beat', 'rms']);
  const wires = g.edges.filter((e) => e.kind === 'bind');
  assert.equal(wires.length, 4);
  const w = wires.find((e) => e.to === gl.id && e.key === 'split');
  assert.equal(w.source, 'bass'); assert.equal(w.amount, -0.3);
  const target = g.nodes.find((n) => n.id === gl.id), idx = target.ports.findIndex((p) => p.key === 'split');
  assert.equal(w.y2, target.y + GEOM.head + idx * GEOM.row + GEOM.row / 2, 'the wire ends on its own row');
  assert.equal(w.x2, GEOM.chainX); assert.ok(w.x1 < w.x2);
  assert.ok(g.nodes.find((n) => n.id === 'clip').ports.some((p) => p.key === 'scale' && p.bound), 'clip-level bindings sit on the clip box');
  const ys = g.nodes.filter((n) => n.kind === 'signal').map((n) => n.y).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= GEOM.sigH, 'signal boxes do not overlap');
});

test('an effect with nothing bound or animated still shows its main knob; keyframed parameters show as animated', () => {
  const { c } = scene();
  const b = createEffect('bloom'); const gr = createEffect('grain'); gr.keyframes.size = [{ t: 0, v: 1 }, { t: 2, v: 3 }];
  c.effects.push(b, gr);
  const g = buildGraph(c);
  assert.deepEqual(g.nodes.find((n) => n.type === 'bloom').ports.map((p) => p.key), ['intensity']);
  const gp = g.nodes.find((n) => n.type === 'grain').ports;
  assert.deepEqual(gp.map((p) => p.key), ['size']); assert.equal(gp[0].animated, true);
});

test('a PREVIEW copy: only what the preview adds is flagged new (effects, and wires on old effects)', () => {
  const { p, c } = scene();
  const old = createEffect('grain'); c.effects.push(old);
  const copy = structuredClone(p);
  applyPlan(copy, [c.id], interpretVision('pulse').plans[1]);
  copy.clips[0].effects.find((e) => e.id === old.id).bindings.amount = { source: 'bass', amount: 0.5 };
  const g = buildGraph(copy.clips[0], c);
  const byType = (t) => g.nodes.find((n) => n.type === t);
  assert.equal(byType('grain').isNew, false); assert.equal(byType('shake').isNew, true);
  assert.equal(g.edges.find((e) => e.to === old.id && e.kind === 'bind').isNew, true, 'a new link on an old effect is new');
  assert.match(describeGraph(g), /new in the preview/);
  assert.ok(buildGraph(c).nodes.every((n) => !n.isNew), 'without a base nothing is "new"');
});

test('describeGraph counts correctly and uses singular/plural', () => {
  const { c } = scene(); c.effects.push(createEffect('grain'));
  assert.equal(describeGraph(buildGraph(c)), '1 effect, 0 links to the music.');
  assert.deepEqual(Object.keys(SIGNAL_LABELS), ['rms', 'bass', 'mid', 'high', 'beat']);
});

test('the layout is a pure view: building a graph never changes the clip', () => {
  const { c } = scene(); const e = createEffect('glitch'); e.bindings.amount = { source: 'bass', amount: 0.5 }; c.effects.push(e);
  const before = JSON.stringify(c);
  buildGraph(c); buildGraph(c, structuredClone(c));
  assert.equal(JSON.stringify(c), before);
});
