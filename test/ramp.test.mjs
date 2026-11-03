import test from 'node:test';
import assert from 'node:assert/strict';
import { rampIntegral, rampInverse, rampAt, hasRamp, sourceAdvance, timelineFor, rateAt, ensureKeyAt, trimRampHead, mirrorRamp, shapeKeys, beatPulseKeys, rampBudget, RAMP_SHAPES, RAMP_KEY, RAMP_MIN, RAMP_MAX } from '../src/shared/ramp.js';
import { createProject, createClip } from '../src/shared/project.js';
import { addMediaClip, splitClip, trimStart, trimEnd, sourceSpan, sourceTimeAt, setSpeed } from '../src/shared/timeline.js';

const close = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ≉ ${b}`);
// numerical integral of the same curve, to check the closed form
const numeric = (keys, tau, n = 20000) => { let s = 0; for (let i = 0; i < n; i++) s += rampAt(keys, ((i + 0.5) / n) * tau) * (tau / n); return s; };

test('closed-form integral matches a numerical integral, before, between and after the keys', () => {
  const keys = [{ t: 0.5, v: 2 }, { t: 1.5, v: 0.25 }, { t: 3, v: 1 }];
  for (const tau of [0, 0.2, 0.5, 0.9, 1.5, 2.2, 3, 4.5]) close(rampIntegral(keys, tau), numeric(keys, tau), 2e-4);
  close(rampIntegral([], 3), 3);
  close(rampIntegral(keys, -1), -2, 1e-9); // flat before the first key
});

test('the inverse undoes the integral, including past the last key', () => {
  const keys = [{ t: 0, v: 0.2 }, { t: 2, v: 3 }];
  for (const tau of [0, 0.4, 1.3, 2, 5]) close(rampInverse(keys, rampIntegral(keys, tau)), tau, 1e-6);
  assert.equal(rampInverse(keys, Infinity), Infinity);
});

function projectWithClip(media = { id: 'm1', kind: 'video', duration: 20, hasAudio: false, name: 'v', path: '/x.mp4' }) {
  const p = createProject(); p.media.push(media);
  const c = addMediaClip(p, media.id, p.tracks.find((t) => t.kind === 'video').id, 0); c.duration = 6; c.in = 2;
  return { p, c };
}

test('source time follows the ramp; without keys it is the old constant-speed formula', () => {
  const { c } = projectWithClip();
  c.speed = 2;
  close(sourceTimeAt(c, 1), 2 + 2); close(sourceSpan(c).duration, 12);
  c.keyframes[RAMP_KEY] = [{ t: 0, v: 0.5 }, { t: 6, v: 0.5 }]; assert.ok(hasRamp(c));
  close(sourceTimeAt(c, 1), 2 + 1); close(sourceSpan(c).duration, 6); close(rateAt(c, 3), 1);
  close(timelineFor(c, 6), 6, 1e-6);
});

test('splitting a ramped clip keeps the picture continuous and the curve intact on both sides', () => {
  const { p, c } = projectWithClip();
  c.keyframes[RAMP_KEY] = [{ t: 0, v: 2 }, { t: 3, v: 0.5 }, { t: 6, v: 1 }];
  const before = [0.5, 2.9, 3.5, 5.5].map((tau) => sourceTimeAt(c, tau));
  const right = splitClip(p, c.id, 3);
  close(sourceTimeAt(c, 2.9), before[1], 1e-6); close(sourceTimeAt(right, 3.5), before[2], 1e-6); close(sourceTimeAt(right, 5.5), before[3], 1e-6);
  close(right.in, 2 + rampIntegral([{ t: 0, v: 2 }, { t: 3, v: 0.5 }, { t: 6, v: 1 }], 3));
  assert.equal(right.keyframes[RAMP_KEY][0].t, 0); close(right.keyframes[RAMP_KEY][0].v, 0.5);
  assert.ok(c.keyframes[RAMP_KEY].at(-1).t <= 3 + 1e-9);
});

test('trimming the head keeps content in place and slides the curve; extending reveals earlier footage', () => {
  const { p, c } = projectWithClip();
  c.keyframes[RAMP_KEY] = [{ t: 1, v: 3 }, { t: 4, v: 0.5 }];
  const at = sourceTimeAt(c, 4.5);
  assert.ok(trimStart(p, c.id, 2));
  close(sourceTimeAt(c, 4.5), at, 0.03); close(c.start, 2); close(c.duration, 4); // cut inside a segment: re-drawn through sampled points, so a hair of error
  assert.ok(trimStart(p, c.id, 1)); // back out by one second
  close(sourceTimeAt(c, 4.5), at, 0.03);
  // cannot go before the start of the file
  assert.ok(trimStart(p, c.id, 0)); assert.ok(c.in >= -1e-9);
});

test('trimming the tail stops where the source runs out, ramp or not', () => {
  const { p, c } = projectWithClip(); c.in = 15; c.duration = 2;
  trimEnd(p, c.id, 100); close(c.duration, 5);
  c.keyframes[RAMP_KEY] = [{ t: 0, v: 2 }, { t: 100, v: 2 }]; c.duration = 1;
  trimEnd(p, c.id, 100); close(c.duration, 2.5, 1e-4);
});

test('changing speed keeps the same stretch of source and stretches the curve with the clip', () => {
  const { p, c } = projectWithClip();
  c.keyframes[RAMP_KEY] = [{ t: 0, v: 1 }, { t: 3, v: 0.5 }];
  const span = sourceSpan(c).duration;
  assert.ok(setSpeed(p, c.id, 2));
  close(sourceSpan(c).duration, span, 1e-6); close(c.duration, 3);
  close(c.keyframes[RAMP_KEY][1].t, 1.5);
});

test('shapes, beat pulse, mirror and the source budget', () => {
  for (const name of Object.keys(RAMP_SHAPES)) { const k = shapeKeys(name, 4); assert.ok(k.length >= 2 && k.every((p) => p.v >= RAMP_MIN && p.v <= RAMP_MAX && p.t >= 0 && p.t <= 4), name); }
  const c = createClip({ type: 'media', start: 2, duration: 3 });
  const keys = beatPulseKeys(c, [1, 2, 2.5, 3, 3.5, 4, 4.5, 6]);
  assert.ok(keys.length >= 6 && keys[0].t === 0 && keys[0].v > keys[1].v, 'a pulse starts on each beat and eases down');
  assert.equal(beatPulseKeys(c, [0, 9]), null);
  c.keyframes[RAMP_KEY] = [{ t: 0, v: 2 }, { t: 1, v: 2 }, { t: 3, v: 1 }]; c.duration = 3;
  const was = c.keyframes[RAMP_KEY].map((k) => k.t); mirrorRamp(c);
  assert.deepEqual(c.keyframes[RAMP_KEY].map((k) => k.t), was.map((t) => 3 - t).sort((a, b) => a - b));
  const b = rampBudget(c, 3); assert.equal(b.fits, false);
  const cut = ensureKeyAt([{ t: 0, v: 1 }, { t: 2, v: 3 }], 1); assert.ok(cut.some((k) => k.t === 1) && cut.length > 3 && cut[0].t === 0 && cut.at(-1).t === 2, 'the cut segment is re-drawn through sampled keys');
  for (const tau of [0.3, 1, 1.7]) close(rampAt(cut, tau), rampAt([{ t: 0, v: 1 }, { t: 2, v: 3 }], tau), 0.02);
  const x = { type: 'media', speed: 1, duration: 4, keyframes: { [RAMP_KEY]: [{ t: 0, v: 1 }, { t: 4, v: 1 }] } };
  close(trimRampHead(x, 1), 1); close(x.keyframes[RAMP_KEY][0].t, 0);
  close(sourceAdvance({ type: 'media', speed: 1.5, keyframes: {} }, 2), 3);
});
