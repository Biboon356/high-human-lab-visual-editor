import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyNotes, addFrame, addExport, addCount, addError, setMachine, cleanNotes, buildReport, scrub, FRAME_EDGES, MAX_BUCKETS, MAX_COUNTS, MAX_ERRORS, MAX_EXPORTS } from '../src/shared/diag/notes.js';

const frame = (n, o) => addFrame(n, { interval: 16, render: 3, w: 1920, h: 1080, effects: 2, heavy: 0, ...o });

test('frames fall into timing buckets by project size and load; the percentiles come from the buckets', () => {
  let n = emptyNotes(1);
  for (let i = 0; i < 90; i++) n = frame(n, { interval: 16 }); for (let i = 0; i < 6; i++) n = frame(n, { interval: 40 }); for (let i = 0; i < 4; i++) n = frame(n, { interval: 200 });
  const r = buildReport(n, 5), b = r.playbackByLoad[0];
  assert.equal(r.playbackByLoad.length, 1); assert.equal(b.size, '1920x1080'); assert.equal(b.effectsOnScreen, 2); assert.equal(b.frames, 100);
  assert.equal(b.medianFrameMs, '<17'); assert.equal(b.p95FrameMs, '<67'); assert.equal(b.shareBelow30fps, 0.1); assert.equal(b.avgDrawMs, 3);
  n = frame(n, { heavy: 2, effects: 5 }); n = frame(n, { w: 1280, h: 720 });
  assert.equal(buildReport(n).playbackByLoad.length, 3, 'a different load or size is its own bucket');
  assert.deepEqual(b.histogramEdgesMs, FRAME_EDGES); assert.equal(b.histogram.reduce((a, x) => a + x, 0), 100);
});

test('bad frames are ignored; buckets, exports, counters and errors are all capped', () => {
  let n = emptyNotes(0); const before = JSON.stringify(n);
  for (const bad of [{ interval: NaN }, { interval: 0 }, { interval: -3 }, { interval: 9000 }, { interval: 16, w: 'x' }]) n = frame(n, bad);
  assert.equal(JSON.stringify(n), before);
  for (let i = 0; i < MAX_BUCKETS + 30; i++) n = frame(n, { w: 100 + i, h: 100 }); assert.ok(Object.keys(n.perf).length <= MAX_BUCKETS);
  for (let i = 0; i < MAX_EXPORTS + 10; i++) n = addExport(n, { w: 1920, h: 1080, fps: 30, frames: i, seconds: 5, effects: 1, heavy: 0, ok: true }); assert.equal(n.exports.length, MAX_EXPORTS); assert.equal(n.exports.at(-1).frames, MAX_EXPORTS + 9);
  for (let i = 0; i < MAX_COUNTS + 20; i++) n = addCount(n, `feature.k${i}`); assert.ok(Object.keys(n.counts).length <= MAX_COUNTS);
  for (let i = 0; i < MAX_ERRORS + 20; i++) n = addError(n, `error number ${i}`); assert.ok(Object.keys(n.errors).length <= MAX_ERRORS);
  const c = addCount(emptyNotes(0), 'a.b'); assert.equal(addCount(c, 'a.b').counts['a.b'], 2); assert.equal(addCount(c, 'Not OK!'), c); assert.equal(addCount(c, '<script>'), c);
  assert.equal(addExport(emptyNotes(0), null).exports.length, 0);
});

test('error text loses paths, addresses, e-mail and ids but keeps its shape; the same error is counted, not repeated', () => {
  assert.equal(scrub('Failed to load /Users/jane/Music/My Song/take1.wav now'), 'Failed to load <path>', 'a path with spaces is removed to the end of the message: no part of a file name stays');
  assert.equal(scrub('cannot read "/Users/jane/My Song/take1.wav" (code 5)'), 'cannot read "<path>" (code 5)', 'but the words around a quoted path stay');
  assert.equal(scrub('open ~/Movies/My Film.mov failed'), 'open <path>'); assert.ok(!/take1|Song|Film/.test(scrub('Failed /a/b/My Song/take1.wav')));
  assert.equal(scrub('ENOENT: no such file "C:\\\\Users\\\\Jane\\\\clip.mov"'), 'ENOENT: no such file "<path>"');
  assert.equal(scrub('hhlab://local/media/ab12 failed (https://example.com/x?token=abc)'), '<url> failed (<url>)');
  assert.equal(scrub('mail jane@example.com id 123e4567-e89b-12d3-a456-426614174000'), 'mail <email> id <id>');
  assert.equal(scrub(null), ''); assert.ok(scrub('x'.repeat(500)).length <= 100);
  let n = emptyNotes(0); n = addError(n, 'Shader failed at /home/a/x.glsl'); n = addError(n, 'Shader failed at /home/b/y.glsl');
  assert.deepEqual(n.errors, { 'Shader failed at <path>': 2 }); assert.equal(addError(n, ''), n);
  assert.ok(!JSON.stringify(buildReport(n)).includes('/home/'));
});

test('machine facts are whitelisted and clipped; nothing else can ride along', () => {
  const n = setMachine(emptyNotes(0), { app: '0.9.7', platform: 'darwin', arch: 'arm64', electron: '40.1.0', chrome: '140.0', cpus: 10, memGB: 16, dpr: 2, gpu: 'ANGLE (Apple, Apple M2, OpenGL 4.1)', software: false, user: 'jane', home: '/Users/jane', path: '/x' });
  assert.deepEqual(Object.keys(n.machine).sort(), ['app', 'arch', 'chrome', 'cpus', 'dpr', 'electron', 'gpu', 'memGB', 'platform', 'software']);
  assert.equal(n.machine.gpu, 'ANGLE (Apple, Apple M2, OpenGL 4.1)');
  assert.equal(setMachine(emptyNotes(0), { gpu: 'x'.repeat(500) }).machine.gpu.length, 120); assert.equal(setMachine(emptyNotes(0), { gpu: 'a<b>c;d' }).machine.gpu, 'abcd');
  assert.equal(setMachine(emptyNotes(0), null).machine.cpus, 0);
});

test('stored notes are repaired on load; junk becomes empty notes; a saved copy loads back the same', () => {
  for (const junk of [null, 5, 'x', [], { v: 9 }, {}]) assert.deepEqual(cleanNotes(junk), emptyNotes(0));
  let n = emptyNotes(7); n = setMachine(n, { app: '1', platform: 'linux', cpus: 4 }); for (let i = 0; i < 20; i++) n = frame(n, {}); n = addCount(n, 'x.y'); n = addError(n, 'oops'); n = addExport(n, { w: 640, h: 360, fps: 30, frames: 30, seconds: 1, effects: 0, heavy: 0, ok: true });
  assert.deepEqual(cleanNotes(JSON.parse(JSON.stringify(n))), n);
  const messy = cleanNotes({ v: 1, since: 'x', perf: { 'bad key': { n: 1, hist: [1] }, '640x360|fx1|h0': { n: 'q', hist: [0, 0, 0, 0, 0, 0, 0] } }, counts: { 'BAD': 1, ok: 'z' }, errors: { '/Users/me/secret.txt failed': 3 }, exports: [null, 5, { w: 1, h: 1 }] });
  assert.deepEqual(Object.keys(messy.perf), ['640x360|fx1|h0']); assert.equal(messy.perf['640x360|fx1|h0'].n, 0); assert.deepEqual(Object.keys(messy.counts), ['ok']); assert.ok(!JSON.stringify(messy).includes('secret'));
  assert.equal(messy.exports.length, 1);
});

test('the report says what it contains and what it never contains, and has nothing but what the notes held', () => {
  let n = setMachine(emptyNotes(1000), { app: '0.9.7', platform: 'win32', cpus: 8, memGB: 16, gpu: 'NVIDIA GeForce' }); n = frame(n, {}); n = addCount(n, 'vision.interpret');
  const r = buildReport(n, 2000);
  assert.equal(r.format, 'hhlab-usage-notes'); assert.equal(r.createdAt, 2000); assert.equal(r.since, 1000);
  assert.deepEqual(Object.keys(r).sort(), ['contains', 'createdAt', 'errors', 'exports', 'featureUse', 'format', 'machine', 'neverContains', 'playbackByLoad', 'since', 'version']);
  assert.ok(r.contains.length >= 4 && r.neverContains.some((x) => /file names/.test(x)) && r.neverContains.some((x) => /API key/.test(x)));
  assert.ok(JSON.stringify(r).length < 20000); assert.deepEqual(buildReport(emptyNotes(0), 0).playbackByLoad, []);
});
