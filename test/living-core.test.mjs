import test from 'node:test';
import assert from 'node:assert/strict';
import { evalTrack } from '../src/shared/keyframes.js';
import { simplifyTrack, cleanSamples, maxError, smoothValues, punchMerge } from '../src/shared/living/simplify.js';
import { createGesture, beginStroke, addPoint, speeds, gestureSeries, mapGesture, simplifyPath, MAX_POINTS } from '../src/shared/living/gesture.js';
import { TakeRecorder } from '../src/shared/living/take.js';

const wave = (n, f) => Array.from({ length: n }, (_, i) => ({ t: i / 60, v: f(i / 60) }));

test('simplifyTrack keeps what you played: error under tolerance, far fewer keys, peaks survive', () => {
  const s = wave(600, (t) => 0.5 + 0.4 * Math.sin(t * 2.2)); // 10 seconds at 60 Hz
  const k = simplifyTrack(s, { tol: 0.02, range: [0, 1] });
  assert.ok(k.length < 30, `${s.length} samples became ${k.length} keys`);
  assert.ok(maxError(s, k) <= 0.02 + 1e-9, `max error ${maxError(s, k)}`);
  assert.equal(k[0].t, 0); assert.equal(k.at(-1).t, s.at(-1).t);
  const peak = s.reduce((a, b) => (b.v > a.v ? b : a));
  assert.ok(Math.abs(evalTrack(k, peak.t, 0) - peak.v) < 0.025, 'the peak is still there');
  // a looser tolerance gives fewer keys, a tighter one more
  assert.ok(simplifyTrack(s, { tol: 0.06, range: [0, 1] }).length < k.length);
  assert.ok(simplifyTrack(s, { tol: 0.008, range: [0, 1] }).length > k.length);
  assert.ok(simplifyTrack(s, { tol: 0.0001, range: [0, 1], maxKeys: 12 }).length <= 12, 'maxKeys is a hard cap');
});

test('simplifyTrack: flat input is two keys, odd input is cleaned, timing of a hold is kept', () => {
  assert.equal(simplifyTrack(wave(200, () => 0.3)).length, 2);
  assert.deepEqual(simplifyTrack([{ t: 1, v: 5 }]), [{ t: 1, v: 5 }]);
  assert.deepEqual(simplifyTrack([]), []);
  assert.deepEqual(cleanSamples([{ t: 2, v: 1 }, { t: NaN, v: 1 }, { t: 1, v: 0 }, { t: 2, v: 9 }, null]), [{ t: 1, v: 0 }, { t: 2, v: 9 }]);
  // a move at 1 s, a rest, a move at 3 s: the rest must still be flat in between
  const s = [{ t: 0, v: 0 }, { t: 0.9, v: 0 }, { t: 1, v: 1 }, { t: 2.9, v: 1 }, { t: 3, v: 0.2 }];
  const k = simplifyTrack(s, { tol: 0.01, range: [0, 1] });
  assert.ok(Math.abs(evalTrack(k, 2, 0) - 1) < 0.02, 'still resting at 2 s');
  assert.ok(Math.abs(evalTrack(k, 0.5, 9)) < 0.02, 'still resting at 0.5 s');
});

test('smoothValues keeps timing and the end points', () => {
  const s = wave(50, (t) => (Math.round(t * 60) % 2 ? 1 : 0));
  const m = smoothValues(s, 1);
  assert.equal(m[0].v, s[0].v); assert.equal(m.at(-1).v, s.at(-1).v);
  assert.deepEqual(m.map((p) => p.t), s.map((p) => p.t));
  assert.ok(Math.max(...m.slice(5, 45).map((p) => p.v)) < 0.75, 'jitter is flattened');
  assert.strictEqual(smoothValues(s, 0), s);
  // a rest between two moves is not dragged into them
  const rest = [{ t: 0, v: 0 }, { t: 1, v: 5 }, { t: 3, v: 5 }, { t: 4, v: 0 }];
  assert.deepEqual(smoothValues(rest, 1).map((p) => p.v), [0, 5, 5, 0]);
});

test('punchMerge replaces the performed stretch and keeps the old keys around it', () => {
  const old = [{ t: 0, v: 0 }, { t: 2, v: 1 }, { t: 5, v: 0.5 }, { t: 9, v: 0 }];
  const m = punchMerge(old, [{ t: 3, v: 0.9 }, { t: 6, v: 0.2 }], 3, 6);
  assert.deepEqual(m.map((k) => k.t), [0, 2, 3, 6, 9]);
  assert.equal(m.find((k) => k.t === 3).v, 0.9);
  assert.deepEqual(punchMerge(null, [{ t: 1, v: 1 }], 1, 1), [{ t: 1, v: 1 }]);
});

test('gesture: points are thinned, clamped and capped; speed is per frame-height and aspect-independent in height', () => {
  const g = createGesture(); beginStroke(g);
  assert.equal(addPoint(g, 0, 0.5, 0.5), true);
  assert.equal(addPoint(g, 0.001, 0.51, 0.5), false, 'faster than 120 Hz is dropped');
  assert.equal(addPoint(g, 0.1, 1.7, -3), true); assert.deepEqual(g.pts.at(-1).slice(1, 3), [1, 0]);
  assert.equal(addPoint(g, NaN, 0, 0), false);
  assert.equal(addPoint(createGesture(), 0, 0.5, 0.5), false, 'no stroke begun');
  const v = createGesture(); beginStroke(v);
  addPoint(v, 0, 0.5, 0.2); addPoint(v, 1, 0.5, 0.7); // half a frame height in one second
  const sp = speeds(v);
  assert.ok(Math.abs(sp[1] - 0.5 * 0.75) < 0.2 && sp[1] > 0.2, `speed ${sp[1]}`);
  const cap = createGesture(); beginStroke(cap);
  for (let i = 0; i < MAX_POINTS + 50; i++) addPoint(cap, i / 60, 0.5, 0.5);
  assert.equal(cap.pts.length, MAX_POINTS);
});

test('gestureSeries holds between strokes; mapGesture writes clip-relative keyframes inside the parameter range', () => {
  const g = createGesture();
  beginStroke(g); for (let i = 0; i <= 30; i++) addPoint(g, 10 + i / 30, 0.2 + 0.4 * (i / 30), 0.5);
  beginStroke(g); for (let i = 0; i <= 30; i++) addPoint(g, 14 + i / 30, 0.9, 0.5);
  const ser = gestureSeries(g);
  const rest = ser.x.filter((p) => p.t > 11.01 && p.t < 14);
  assert.ok(rest.length >= 2 && rest.every((p) => Math.abs(p.v - 0.6) < 1e-9), 'x rests at the end of stroke one until just before stroke two');
  const owner = { keyframes: {} };
  const out = mapGesture(g, [{ owner, key: 'x', offset: 10, axis: 'x', fn: (u) => (u - 0.5) * 2, range: [-1, 1] }, { owner, key: 'amount', offset: 10, axis: 'speed', fn: (s) => s, range: [0, 1] }]);
  assert.equal(out.length, 2);
  const x = out[0];
  assert.ok(x.track[0].t >= 0 && x.track[0].t < 0.1, 'times are relative to the owner (offset 10)');
  assert.ok(x.track.every((k) => k.v >= -1 && k.v <= 1));
  assert.ok(Math.abs(evalTrack(x.track, 1.0, 0) - 0.2) < 0.06, 'x at 11 s is 0.2*2-... about (0.6-0.5)*2');
  assert.ok(Math.abs(evalTrack(x.track, 5, 0) - 0.8) < 0.06, 'x at 15 s is (0.9-0.5)*2');
  assert.ok(out[1].track.length >= 2);
  assert.deepEqual(mapGesture(createGesture(), [{ owner, key: 'x', offset: 0, axis: 'x', fn: (u) => u, range: [0, 1] }]), []);
});

test('simplifyPath keeps timing and drops points that do not move', () => {
  const g = createGesture(); beginStroke(g);
  for (let i = 0; i < 100; i++) addPoint(g, i / 60, 0.5 + (i < 50 ? 0 : (i - 50) * 0.01), 0.5);
  const p = simplifyPath(g);
  assert.ok(p.length < g.pts.length && p.length >= 40, `${g.pts.length} -> ${p.length}`);
  assert.deepEqual(p.at(-1), [Math.round(g.pts.at(-1)[0] * 1000) / 1000, Math.round(g.pts.at(-1)[1] * 1e4) / 1e4, Math.round(g.pts.at(-1)[2] * 1e4) / 1e4, 0]);
});

test('TakeRecorder: takes over a parameter, writes the performance as keyframes, keeps old keys outside the take', () => {
  const owner = { keyframes: { amount: [{ t: 0, v: 0.1 }, { t: 1, v: 0.2 }, { t: 6, v: 0.7 }, { t: 9, v: 0.9 }] } };
  const rec = new TakeRecorder(); rec.start(10);
  // the clip starts at timeline 8, so local time = timeline - 8; the take runs from 10 s to 14 s
  const def = { min: 0, max: 1 };
  for (let i = 0; i <= 60; i++) { const tl = 10 + i / 30; rec.capture({ owner, key: 'amount', v: 0.5 + 0.4 * Math.sin(i / 8), t: tl - 8, now: tl, def }); if (i === 0) assert.equal(owner.keyframes.amount, undefined, 'old keys are set aside while performing'); }
  const r = rec.finish({ tEnd: 14 });
  assert.equal(rec.active, false);
  assert.equal(r.parameters, 1); assert.ok(r.keys >= 3 && r.keys < 40, `${r.keys} keys`);
  const k = owner.keyframes.amount;
  assert.ok(k.some((x) => x.t === 0) && k.some((x) => x.t === 1), 'old keys before the take are kept');
  assert.ok(k.some((x) => x.t === 9), 'and old keys after it');
  assert.ok(k.every((x) => !(x.t > 2.05 && x.t < 5.95 && Math.abs(x.v - 0.7) < 1e-9)) && k.find((x) => x.t === 6).v !== 0.7, 'the stretch that was performed (local 2..6 s) is replaced: the old 0.7 key is gone');
  assert.ok(k.every((x, i) => i === 0 || x.t > k[i - 1].t), 'sorted, no duplicates');
  assert.ok(k.every((x) => x.v >= 0 && x.v <= 1));
});

test('TakeRecorder: holds are kept as rests, the end of the take holds the last value, cancel restores everything', () => {
  const owner = { keyframes: {} }, def = { min: 0, max: 10 };
  const rec = new TakeRecorder(); rec.start(0);
  rec.capture({ owner, key: 'k', v: 2, t: 1, now: 1, def });
  rec.capture({ owner, key: 'k', v: 8, t: 4, now: 4, def }); // three seconds of rest, then a jump
  rec.finish({ tEnd: 6 });
  const k = owner.keyframes.k;
  assert.ok(Math.abs(evalTrack(k, 3, 0) - 2) < 0.2, 'resting at 2 until just before the move');
  assert.ok(Math.abs(evalTrack(k, 6, 0) - 8) < 0.01, 'the end of the take stays at the last value');

  const o2 = { keyframes: { k: [{ t: 0, v: 1 }, { t: 5, v: 2 }] } };
  const r2 = new TakeRecorder(); r2.start(0);
  r2.capture({ owner: o2, key: 'k', v: 9, t: 2, now: 2, def });
  assert.equal(o2.keyframes.k, undefined);
  r2.cancel();
  assert.deepEqual(o2.keyframes.k, [{ t: 0, v: 1 }, { t: 5, v: 2 }]);
  assert.equal(r2.active, false);
  // ignores bad input and anything before start()
  const r3 = new TakeRecorder(); r3.capture({ owner, key: 'z', v: 1, t: 0, now: 0, def }); r3.start(0); r3.capture({ owner, key: 'z', v: NaN, t: 0, now: 0, def });
  assert.equal(r3.touched, 0);
});

test('a performance is reproducible: the same samples give the same keyframes', () => {
  const run = () => { const o = { keyframes: {} }, rec = new TakeRecorder(); rec.start(0); for (let i = 0; i < 200; i++) rec.capture({ owner: o, key: 'a', v: 0.5 + 0.3 * Math.sin(i / 9), t: i / 60, now: i / 60, def: { min: 0, max: 1 } }); rec.finish({ tEnd: 200 / 60 }); return o.keyframes.a; };
  assert.deepEqual(run(), run());
});
