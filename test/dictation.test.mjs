import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { floatToInt16, rmsOf, prepareDictation, joinSegments, dictationPrompt, DICTATION_RATE } from '../src/shared/command/dictation.js';
import { transcribeDictation, releaseEngine } from '../src/main/asr.js';

const tone = (sec, amp = 0.2) => { const f = new Float32Array(Math.round(sec * DICTATION_RATE)); for (let i = 0; i < f.length; i++) f[i] = amp * Math.sin(i / 20); return floatToInt16(f); };
const fakeLoader = (segments, log = []) => async () => ({ initWhisper: async () => ({ release: async () => {}, transcribeData: (buf, opts) => { log.push({ bytes: buf.byteLength, language: opts.language, prompt: opts.prompt }); return { stop: async () => {}, promise: Promise.resolve({ language: 'th', isAborted: false, segments }) }; } }) });

test('floatToInt16 clamps and keeps the sign', () => {
  const o = floatToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
  assert.deepEqual([...o], [0, 32767, -32768, 32767, -32768, 16383]);
});

test('prepareDictation refuses silence and clicks, so whisper is never asked to make words up', () => {
  assert.equal(prepareDictation(new Int16Array(DICTATION_RATE * 2)).ok, false, 'two seconds of silence');
  assert.match(prepareDictation(new Int16Array(DICTATION_RATE * 2)).reason, /did not hear/);
  assert.match(prepareDictation(tone(0.2)).reason, /too short/);
  assert.equal(prepareDictation(tone(2, 0.002)).ok, false, 'a very quiet room');
  assert.equal(prepareDictation(tone(2, 0.2)).ok, true);
});

test('prepareDictation pads short takes to about 1.2 s and cuts long ones at 15 s', () => {
  const short = prepareDictation(tone(0.6)); assert.ok(short.pcm.length >= 1.2 * DICTATION_RATE); assert.equal(short.seconds, 0.6);
  const long = prepareDictation(tone(20)); assert.equal(long.pcm.length, 15 * DICTATION_RATE);
  assert.ok(rmsOf(long.pcm) > 0.1);
});

test('joinSegments: Thai runs together, Latin words keep their space, blanks dropped', () => {
  assert.equal(joinSegments([{ text: ' ให้ ' }, { text: 'ตามเบส' }]), 'ให้ตามเบส');
  assert.equal(joinSegments([{ text: 'glitch' }, { text: 'follow' }, { text: 'bass' }]), 'glitch follow bass');
  assert.equal(joinSegments([{ text: '' }, { text: '  ' }]), '');
  assert.equal(joinSegments(null), '');
});

test('transcribeDictation: text comes back, the vocabulary hint is passed, nothing runs for silence', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-dict-')), model = path.join(dir, 'm.bin'); fs.writeFileSync(model, 'x');
  const log = [];
  const ok = await transcribeDictation({ pcm: tone(2), modelPath: model, language: 'th', prompt: dictationPrompt(['Grain']), loader: fakeLoader([{ text: 'glitch', t0: 0, t1: 500 }, { text: 'ตามเบส', t0: 500, t1: 1500 }], log) });
  assert.deepEqual(ok, { ok: true, text: 'glitchตามเบส', seconds: 2 });
  assert.match(log[0].prompt, /Grain/); assert.equal(log[0].language, 'th');
  const before = log.length;
  const quiet = await transcribeDictation({ pcm: new Int16Array(DICTATION_RATE * 2), modelPath: model, loader: fakeLoader([], log) });
  assert.equal(quiet.ok, false); assert.equal(log.length, before, 'the model was not even asked');
  await releaseEngine(); // the engine is cached per model file: a new fake needs a fresh one
  const nothing = await transcribeDictation({ pcm: tone(2), modelPath: model, loader: fakeLoader([{ text: '[BLANK_AUDIO]', t0: 0, t1: 900 }], log) });
  assert.equal(nothing.ok, false); assert.match(nothing.reason, /make out/);
  await releaseEngine();
});

import { allowPermission } from '../src/main/permissions.js';
test('permissions: fonts and audio-only microphone are allowed; camera, mixed capture and everything else are refused', () => {
  assert.equal(allowPermission('local-fonts'), true);
  assert.equal(allowPermission('media', { mediaTypes: ['audio'] }), true);
  assert.equal(allowPermission('media', { mediaType: 'audio' }), true);
  assert.equal(allowPermission('media', { mediaTypes: ['video'] }), false);
  assert.equal(allowPermission('media', { mediaTypes: ['audio', 'video'] }), false);
  assert.equal(allowPermission('media', {}), false, 'unknown kind of capture');
  assert.equal(allowPermission('media'), false);
  for (const x of ['geolocation', 'notifications', 'clipboard-read', 'display-capture', 'midi']) assert.equal(allowPermission(x, { mediaTypes: ['audio'] }), false, x);
});
