import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODELS, modelStatus, transcribePcm, releaseEngine, ensureModel } from '../src/main/asr.js';
import { rmsEnvelope } from '../src/shared/audio-analysis.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-asr-'));
const fakeLoader = (log = []) => async () => ({
  initWhisper: async (o) => { if (!o.filePath) throw new Error('Model path is required'); log.push(['init', o.filePath]); return { release: async () => log.push(['release']), transcribeData: (buf, opts) => {
    log.push(['transcribe', buf.byteLength, opts.language, opts.beamSize]); opts.onProgress?.(50); opts.onProgress?.(100);
    return { stop: async () => log.push(['stop']), promise: Promise.resolve({ language: 'th', isAborted: false, segments: [
      { text: ' สวัสดีครับ ', t0: 500, t1: 1800 }, { text: '[BLANK_AUDIO]', t0: 1800, t1: 2500 }, { text: '(music)', t0: 2500, t1: 3000 }, { text: '', t0: 3000, t1: 3100 }, { text: 'วันนี้ดีมาก', t0: 3200, t1: 5000 }] }) };
  } }; },
});

test('model catalogue reports installed / partial files by size', () => {
  const dir = tmp();
  assert.ok(Object.values(modelStatus(dir)).every((m) => !m.installed && m.bytes === 0));
  fs.writeFileSync(path.join(dir, MODELS.fast.file), Buffer.alloc(10)); // too small to be a real model
  assert.equal(modelStatus(dir).fast.installed, false);
  fs.writeFileSync(path.join(dir, MODELS.fast.file + '.part'), Buffer.alloc(77));
  assert.equal(modelStatus(dir).fast.partial, 77);
  assert.ok(Object.values(MODELS).every((m) => m.file.startsWith('ggml-') && m.approxMB > 100));
});

test('transcribePcm: milliseconds -> seconds, blanks/noise tags removed, progress forwarded, engine reused', async () => {
  const dir = tmp(), model = path.join(dir, 'm.bin'); fs.writeFileSync(model, 'x');
  const log = [], prog = [];
  const r = await transcribePcm({ pcm: new Int16Array(16000), modelPath: model, loader: fakeLoader(log), onProgress: (p) => prog.push(p) });
  assert.deepEqual(r.segments, [{ text: 'สวัสดีครับ', start: 0.5, end: 1.8 }, { text: 'วันนี้ดีมาก', start: 3.2, end: 5 }]);
  assert.deepEqual(prog, [50, 100]); assert.deepEqual(log[1], ['transcribe', 32000, 'th', 5]);
  await transcribePcm({ pcm: new Int16Array(16000), modelPath: model, loader: fakeLoader(log) });
  assert.equal(log.filter((l) => l[0] === 'init').length, 1, 'same model: context is reused, not reloaded');
  await releaseEngine(); assert.ok(log.some((l) => l[0] === 'release'));
});

test('transcribePcm: clear errors for missing model, missing engine, unopenable model, cancellation', async () => {
  await assert.rejects(transcribePcm({ pcm: new Int16Array(10), modelPath: '/nope/m.bin', loader: fakeLoader() }), /not downloaded/);
  const model = path.join(tmp(), 'm.bin'); fs.writeFileSync(model, 'x');
  await assert.rejects(transcribePcm({ pcm: new Int16Array(10), modelPath: model, loader: async () => { throw Object.assign(new Error('boom'), { code: 'ERR_DLOPEN_FAILED' }); } }), /speech engine could not be loaded.*ERR_DLOPEN_FAILED/);
  await releaseEngine();
  await assert.rejects(transcribePcm({ pcm: new Int16Array(10), modelPath: model, loader: async () => ({ initWhisper: async () => { throw new Error('bad magic'); } }) }), /model could not be opened.*bad magic/);
  const cancelLoader = async () => ({ initWhisper: async () => ({ release: async () => {}, transcribeData: () => ({ stop: async () => {}, promise: Promise.resolve({ isAborted: true, segments: [] }) }) }) });
  await releaseEngine();
  await assert.rejects(transcribePcm({ pcm: new Int16Array(10), modelPath: model, loader: cancelLoader }), /cancelled/);
  await releaseEngine();
});

test('the real whisper.cpp binding loads on this platform and rejects a garbage model file cleanly', async () => {
  const model = path.join(tmp(), 'garbage.bin'); fs.writeFileSync(model, Buffer.from('this is not a ggml model'));
  await releaseEngine();
  await assert.rejects(transcribePcm({ pcm: new Int16Array(16000), modelPath: model }), /speech model could not be opened|speech engine could not be loaded/);
  await releaseEngine();
});

test('ensureModel downloads into the models folder from a configurable base URL', async () => {
  const http = await import('node:http');
  const body = Buffer.alloc(200e6 > 1e9 ? 1 : 150_500_000 > 0 ? 160e6 : 1, 7);
  const s = http.createServer((q, r) => { r.writeHead(200, { 'Content-Length': body.length }); r.end(body); }).listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  process.env.HHLAB_MODEL_BASE = `http://127.0.0.1:${s.address().port}`;
  const dir = tmp(); let last = 0;
  const p = await ensureModel(dir, 'fast', { onProgress: (x) => { last = x.received; } });
  assert.equal(path.basename(p), MODELS.fast.file); assert.equal(fs.statSync(p).size, body.length); assert.equal(last, body.length);
  assert.equal(modelStatus(dir).fast.installed, true);
  await assert.rejects(ensureModel(dir, 'nope'), /Unknown speech model/);
  s.closeAllConnections?.(); s.close(); delete process.env.HHLAB_MODEL_BASE;
});

test('rmsEnvelope: levels follow loudness, frame rate is exact', () => {
  const sr = 16000, x = new Int16Array(sr * 2);
  for (let i = sr; i < sr * 2; i++) x[i] = Math.round(16000 * Math.sin(i * 0.1));
  const e = rmsEnvelope(x, sr, 100);
  assert.equal(e.rate, 100); assert.equal(e.rms.length, 200);
  assert.ok(e.rms[50] < 0.001 && e.rms[150] > 0.3 && e.rms[150] < 0.4, `silence ${e.rms[50]}, tone ${e.rms[150]}`);
});

// Regression: the real binding takes the model as `filePath`; passing `model` fails with "Model path is required".
// A garbage file must get past that check and be rejected by whisper.cpp itself.
test('transcribePcm: real whisper binding receives the model path (garbage file is rejected by whisper, not by option validation)', async (t) => {
  try { await import('@fugood/whisper.node'); } catch { t.skip('native whisper binding not available on this machine'); return; }
  const model = path.join(tmp(), 'garbage.bin'); fs.writeFileSync(model, 'not a ggml model');
  await releaseEngine();
  await assert.rejects(transcribePcm({ pcm: new Int16Array(16000), modelPath: model }), (e) => /model could not be opened/.test(e.message) && !/Model path is required/.test(e.message));
  await releaseEngine();
});
