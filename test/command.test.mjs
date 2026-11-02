import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../src/shared/command/parse.js';
import { createProject, createClip } from '../src/shared/project.js';
import { createEffect } from '../src/shared/effects-defs.js';

function scene() {
  const p = createProject();
  p.media.push({ id: 'm1', kind: 'video', name: 'v', path: '/x.mp4', duration: 20, width: 640, height: 360 });
  const v1 = p.tracks.find((t) => t.kind === 'video');
  const c = createClip({ type: 'media', mediaId: 'm1', name: 'A', start: 0, duration: 5, trackId: v1.id });
  p.clips.push(c);
  return { p, c, ctx: { clipIds: [c.id], hasAnalysis: true } };
}
const run = (text, extra = {}) => { const { p, c, ctx } = scene(); if (extra.fx) c.effects.push(createEffect(extra.fx)); const r = parseCommand(text, p, { ...ctx, ...extra.ctx }); return { p, c, r }; };

test('English: glitch react to bass binds the default parameter and adds the effect', () => {
  const { p, c, r } = run('glitch react to bass');
  assert.ok(r.ok); assert.equal(r.intent, 'bind');
  assert.match(r.understood[0], /Glitch › Intensity ← bass/);
  assert.equal(c.effects.length, 0, 'parsing alone changes nothing');
  assert.ok(r.apply(p));
  const fx = p.clips[0].effects.find((e) => e.type === 'glitch');
  assert.deepEqual(fx.bindings.amount, { source: 'bass', amount: 0.5 });
});

test('Thai: ให้ grain ตามความดัง → Grain amount follows loudness (rms)', () => {
  const { p, r } = run('ให้ grain ตามความดัง');
  assert.ok(r.ok);
  r.apply(p);
  assert.equal(p.clips[0].effects[0].type, 'grain');
  assert.equal(p.clips[0].effects[0].bindings.amount.source, 'rms');
});

test('Thai: กระตุกตามเบสแรงๆ → Shake, bass, strong', () => {
  const { p, r } = run('กระตุกตามเบสแรงๆ');
  assert.ok(r.ok);
  r.apply(p);
  const fx = p.clips[0].effects.find((e) => e.type === 'shake');
  assert.equal(fx.bindings.amount.source, 'bass');
  assert.equal(fx.bindings.amount.amount, 0.85);
});

test('an existing effect is reused, not duplicated', () => {
  const { p, r } = run('grain follow loudness', { fx: 'grain' });
  r.apply(p);
  assert.equal(p.clips[0].effects.length, 1);
  assert.ok(p.clips[0].effects[0].bindings.amount);
});

test('an explicit parameter wins over the default one', () => {
  const { p, r } = run('glitch rgb split follow high'.replace('rgb ', ''));
  r.apply(p);
  const fx = p.clips[0].effects[0];
  assert.ok(fx.bindings.split, 'split');
  assert.equal(fx.bindings.split.source, 'high');
  assert.equal(fx.bindings.amount, undefined);
});

test('no signal named: a guess is made AND said', () => {
  const { r } = run('shake react to the music'.replace('the music', ''));
  assert.ok(r.ok);
  assert.ok(r.notes.some((n) => /my guess/.test(n)), r.notes.join('|'));
  assert.match(r.understood[0], /bass/);
});

test('"sound" alone is loudness and says so', () => {
  const { r } = run('grain follow the sound');
  assert.match(r.understood[0], /loudness/);
  assert.ok(r.notes.some((n) => /broad/.test(n)));
});

test('"mid" is not found inside other words', () => {
  const { r } = run('glitch follow the middle of nothing');
  assert.ok(r.ok);
  assert.ok(!/mids/.test(r.understood[0]));
});

test('clip properties: zoom follows bass', () => {
  const { p, r } = run('zoom follow bass');
  assert.ok(r.ok);
  r.apply(p);
  assert.deepEqual(p.clips[0].bindings.scale, { source: 'bass', amount: 0.5 });
});

test('subtle, percent and inverted change the amount', () => {
  let { r, p } = run('bloom follow bass subtle'); r.apply(p);
  assert.equal(p.clips[0].effects[0].bindings.intensity.amount, 0.25);
  ({ r, p } = run('bloom follow bass 40%')); r.apply(p);
  assert.equal(p.clips[0].effects[0].bindings.intensity.amount, 0.4);
  ({ r, p } = run('bloom follow bass invert')); r.apply(p);
  assert.equal(p.clips[0].effects[0].bindings.intensity.amount, -0.5);
});

test('several effects in one sentence', () => {
  const { p, r } = run('glitch and grain follow bass');
  r.apply(p);
  assert.deepEqual(p.clips[0].effects.map((e) => e.type).sort(), ['glitch', 'grain']);
});

test('unbind removes only what is there', () => {
  const { p, c } = scene();
  const e = createEffect('glitch'); e.bindings.amount = { source: 'bass', amount: 0.5 }; c.effects.push(e);
  const r = parseCommand('ปิดการตอบสนองของ glitch', p, { clipIds: [c.id], hasAnalysis: true });
  assert.ok(r.ok); assert.equal(r.intent, 'unbind');
  assert.ok(r.apply(p));
  assert.equal(p.clips[0].effects[0].bindings.amount, undefined);
  assert.equal(r.apply(p), false, 'nothing left to remove');
});

test('silence on what it does not understand: a reason, never a guess', () => {
  assert.equal(run('').r.ok, false);
  assert.equal(run('make it beautiful').r.ok, false);
  assert.equal(run('react to bass').r.ok, false, 'no target');
  const { p, c } = scene();
  assert.equal(parseCommand('glitch follow bass', p, { clipIds: [], hasAnalysis: true }).ok, false, 'no clip selected');
});

test('a missing analysis is mentioned (the UI analyzes before previewing)', () => {
  const { r } = run('glitch follow bass', { ctx: { hasAnalysis: false } });
  assert.ok(r.notes.some((n) => /not analyzed/.test(n)));
});

test('binding does not leave the project invalid and reactive stays on', () => {
  const { p, r } = run('glitch follow bass');
  p.reactive.enabled = false;
  r.apply(p);
  assert.equal(p.reactive.enabled, true);
});

test('Thai "ยึดโยงกับ" counts as binding, with or without a named sound', () => {
  let { p, r } = run('อยากให้ effect glitch ยึดโยงกับเสียงเบส');
  assert.ok(r.ok); r.apply(p);
  assert.deepEqual(p.clips[0].effects[0].bindings.amount, { source: 'bass', amount: 0.5 });
  r = run('glitch ยึดโยง').r;
  assert.ok(r.ok); assert.match(r.understood[0], /Glitch › Intensity ← bass/); assert.ok(r.notes.some((n) => /my guess/.test(n)));
});
