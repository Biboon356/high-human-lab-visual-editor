import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, describeGraph, GEOM, SIGNAL_LABELS } from '../src/shared/graph/layout.js';
import { liveGraph } from '../src/shared/graph/live.js';
import { resolveParam } from '../src/shared/params.js';
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

test('heavy effects are marked from the same classification the Mutate engine uses, and the caption says when there are too many', () => {
  const { c } = scene();
  c.effects.push(createEffect('grain'), createEffect('pattern'));
  let g = buildGraph(c);
  assert.equal(g.nodes.find((n) => n.type === 'grain').cost, 'light'); assert.equal(g.nodes.find((n) => n.type === 'pattern').cost, 'heavy'); assert.equal(g.nodes.find((n) => n.type === 'blur'), undefined);
  assert.equal(g.heavy, 1); assert.match(describeGraph(g), /1 heavy effect\./); assert.doesNotMatch(describeGraph(g), /stutter/);
  c.effects.push(createEffect('object3d'), createEffect('pattern'));
  g = buildGraph(c);
  assert.equal(g.heavy, 3); assert.match(describeGraph(g), /3 heavy effects: more than the editor suggests/);
  c.effects.forEach((e) => { if (e.type !== 'grain') e.enabled = false; });
  assert.equal(buildGraph(c).heavy, 0, 'a switched-off effect costs nothing');
  assert.equal(buildGraph(scene().c).heavy, 0);
});

test('ports carry their numeric range and base so the picture can be computed live', () => {
  const { c } = scene(); const e = createEffect('glitch'); e.bindings.amount = { source: 'bass', amount: 0.5 }; e.params.amount = 0.4; c.effects.push(e);
  const p = buildGraph(c).nodes.find((n) => n.type === 'glitch').ports[0];
  assert.deepEqual(p.range, [0, 1]); assert.equal(p.base, 0.4);
});

test('live values match what the renderer resolves, move with the signal, and are plain numbers without audio', () => {
  const { c } = scene();
  const e = createEffect('glitch'); e.params.amount = 0.2; e.bindings.amount = { source: 'bass', amount: 0.5 };
  const k = createEffect('grain'); k.params.size = 1; k.keyframes.size = [{ t: 0, v: 1 }, { t: 2, v: 3 }];
  c.start = 1; c.effects.push(e, k); c.bindings.scale = { source: 'beat', amount: 0.5 };
  const g = buildGraph(c);
  const loud = liveGraph(c, 1, { rms: 0.5, bass: 1, mid: 0.2, high: 0.1, beat: 1 }, g);
  const quiet = liveGraph(c, 1, { rms: 0.1, bass: 0, mid: 0, high: 0, beat: 0 }, g);
  const key = `${e.id}|amount`;
  assert.equal(loud.ports[key], String(+resolveParam(e, 'amount', 0.2, 0, { bass: 1 }, [0, 1]).toFixed(3)));
  assert.equal(loud.ports[key], '0.7'); assert.equal(quiet.ports[key], '0.2');
  assert.deepEqual(loud.wires[key], { source: 'bass', level: 1, push: 0.5 }); assert.equal(quiet.wires[key].level, 0);
  assert.equal(loud.signals.bass, 1); assert.equal(quiet.signals.bass, 0);
  assert.equal(liveGraph(c, 2, quiet).ports[`${k.id}|size`], '2', 'a keyframed parameter is read at the clip-relative time (project time 2 = 1 s into the clip)');
  assert.equal(liveGraph(c, 99, quiet).ports[`${k.id}|size`], '3', 'past the end it holds the last keyframe');
  assert.equal(liveGraph(c, 0, quiet).ports[`${k.id}|size`], '1', 'before the clip starts it holds the first');
  assert.equal(loud.ports['clip|scale'], '3.475', 'a binding moves the value by amount x the parameter\'s whole range (Scale spans 0.05 to 5)'); assert.equal(quiet.ports['clip|scale'], '1');
  const off = liveGraph(c, 1, null, g);
  assert.equal(off.reactive, false); assert.equal(off.ports[key], '0.2'); assert.deepEqual(off.wires, {}); assert.equal(off.signals.bass, 0);
});

test('live values are tolerant: no clip, an empty graph, garbage features', () => {
  assert.deepEqual(liveGraph(null, 0, null).ports, {});
  const { c } = scene(); const e = createEffect('grain'); e.bindings.amount = { source: 'rms', amount: 0.5 }; c.effects.push(e);
  const r = liveGraph(c, 0, { rms: NaN, bass: undefined, mid: 5, high: -2, beat: 'x' });
  assert.equal(r.signals.rms, 0); assert.equal(r.signals.mid, 1); assert.equal(r.signals.high, 0);
  assert.ok(Number.isFinite(Number(r.ports[`${e.id}|amount`])));
});

test('computing live values never changes the clip', () => {
  const { c } = scene(); const e = createEffect('glitch'); e.bindings.amount = { source: 'bass', amount: 0.5 }; c.effects.push(e);
  const before = JSON.stringify(c);
  liveGraph(c, 1, { rms: 1, bass: 1, mid: 1, high: 1, beat: 1 });
  assert.equal(JSON.stringify(c), before);
});

test('allSignals draws all five signal boxes for editing: the used ones where their wires go, the unused ones dimmed below, none overlapping', () => {
  const { c } = scene(); const e = createEffect('glitch'); e.bindings.amount = { source: 'bass', amount: 0.5 }; c.effects.push(e);
  const g = buildGraph(c, null, { allSignals: true });
  const sigs = g.nodes.filter((n) => n.kind === 'signal');
  assert.deepEqual(sigs.map((n) => n.source).sort(), ['bass', 'beat', 'high', 'mid', 'rms']);
  assert.deepEqual(sigs.filter((n) => n.unused).map((n) => n.source).sort(), ['beat', 'high', 'mid', 'rms']); assert.equal(sigs.find((n) => n.source === 'bass').unused, false);
  const ys = sigs.map((n) => n.y).sort((a, b) => a - b); for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= GEOM.sigH, 'no overlap'); assert.ok(ys.every(Number.isFinite));
  assert.ok(sigs.find((n) => n.source === 'bass').y < Math.min(...sigs.filter((n) => n.unused).map((n) => n.y)), 'the used one comes first');
  assert.ok(g.height >= Math.max(...sigs.map((n) => n.y + n.h)), 'the picture is tall enough for them all');
  assert.equal(buildGraph(c).nodes.filter((n) => n.kind === 'signal').length, 1, 'by default only the used ones');
  assert.equal(buildGraph(scene().c, null, { allSignals: true }).nodes.filter((n) => n.kind === 'signal').length, 5, 'even with nothing linked');
});
