import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGlossary, applyGlossary, promptTerms, learnCorrections } from '../src/shared/glossary.js';
import { planAsrChunks, composePrompt } from '../src/shared/asr-plan.js';
import { transcribeChunks } from '../src/main/asr.js';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

test('glossary: normalises, applies longest-first, exposes prompt terms', () => {
  const g = normalizeGlossary([{ from: 'ติ๊กต๊อก', to: 'TikTok' }, { from: 'ก', to: 'x' }, { from: 'same', to: 'same' }, { from: ' แคปชั่น ', to: 'แคปชัน ' }]);
  assert.deepEqual(g, [{ from: 'ติ๊กต๊อก', to: 'TikTok' }, { from: 'แคปชั่น', to: 'แคปชัน' }]);
  assert.equal(applyGlossary('เล่นติ๊กต๊อกแล้วทำแคปชั่น', g), 'เล่นTikTokแล้วทำแคปชัน');
  assert.deepEqual(promptTerms(g), ['TikTok', 'แคปชัน']);
  assert.equal(applyGlossary('abc', []), 'abc');
});

test('learnCorrections: finds the replaced words, ignores pure insertions/deletions and identical text', () => {
  const r = learnCorrections('วันนี้เรามาคุยเรื่องติ๊กต๊อกกัน', 'วันนี้เรามาคุยเรื่องทิกท็อกกัน');
  assert.ok(r.length >= 1, JSON.stringify(r));
  assert.ok(r.every((e) => e.from.length >= 2 && e.from !== e.to));
  assert.match(r.map((e) => e.to).join(''), /ทิกท็อก|ท็อก|ทิก/);
  assert.deepEqual(learnCorrections('สวัสดีครับ', 'สวัสดีครับ'), []);
  assert.deepEqual(learnCorrections('สวัสดี ครับ', 'สวัสดี'), []);
});

const envOf = (voiced, rate = 100) => { const total = Math.max(...voiced.map((v) => v[1])) + 2; const rms = new Float32Array(Math.round(total * rate)).fill(0.001); for (const [a, b] of voiced) for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) rms[i] = 0.3 + 0.1 * Math.sin(i); return { rate, rms }; };

test('planAsrChunks: one chunk per voiced region, padded, non-overlapping, long regions split in a quiet spot', () => {
  const env = envOf([[1, 4], [4.4, 6], [12, 14]]);
  const c = planAsrChunks(env, 16);
  assert.equal(c.length, 2, JSON.stringify(c)); // the 0.4 s gap is merged; the 6 s gap is not
  assert.ok(c[0].start < 1 && c[0].end > 6 && c[0].end < 7);
  assert.ok(c[1].start > 6 && c[1].start <= 12 && c[1].end >= 14);
  for (let i = 1; i < c.length; i++) assert.ok(c[i].start >= c[i - 1].end);
  // 40 s of continuous speech with one dip at 21 s
  const long = envOf([[0, 40]]); for (let i = 2080; i < 2120; i++) long.rms[i] = 0.002;
  const lc = planAsrChunks(long, 42);
  assert.ok(lc.length >= 2 && lc.every((x) => x.end - x.start <= 27.1), JSON.stringify(lc));
  assert.ok(Math.abs(lc[0].end - 21) < 1.5, `split near the dip, got ${lc[0].end}`);
  assert.deepEqual(planAsrChunks({ rate: 100, rms: new Float32Array(500) }, 5), []);
});

test('composePrompt: vocabulary + tail of previous text, bounded', () => {
  assert.equal(composePrompt({}), '');
  assert.equal(composePrompt({ terms: ['TikTok', 'TikTok', ' CapCut '], prev: 'สวัสดีครับ' }), 'TikTok CapCut สวัสดีครับ');
  assert.ok(composePrompt({ terms: ['x'.repeat(300)], prev: 'y'.repeat(500) }).length <= 140);
});

test('transcribeChunks: times are shifted onto the clip timeline, context carries over, short chunks padded, echo dropped', async () => {
  const model = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-ck-')), 'm.bin'); fs.writeFileSync(model, 'x');
  const calls = [];
  const loader = async () => ({ initWhisper: async () => ({ release: async () => {}, transcribeData: (buf, o) => {
    calls.push({ bytes: buf.byteLength, prompt: o.prompt });
    o.onProgress?.(100);
    const i = calls.length;
    return { stop: async () => {}, promise: Promise.resolve({ isAborted: false, segments: [{ text: ` ประโยค${i} `, t0: 200, t1: 900 }, ...(i === 2 ? [{ text: o.prompt, t0: 900, t1: 1000 }] : [])] }) };
  } }) });
  const pcm = new Int16Array(16000 * 20);
  const prog = [];
  const r = await transcribeChunks({ pcm, chunks: [{ start: 1, end: 4 }, { start: 10, end: 10.5 }], modelPath: model, terms: ['TikTok'], loader, onProgress: (p) => prog.push(p) });
  assert.deepEqual(r.segments.map((s) => [s.text, +s.start.toFixed(2), +s.end.toFixed(2)]), [['ประโยค1', 1.2, 1.9], ['ประโยค2', 10.2, 10.5]]);
  assert.equal(calls[0].prompt, 'TikTok');
  assert.match(calls[1].prompt, /^TikTok ประโยค1$/);
  assert.ok(calls[1].bytes >= 1.2 * 16000 * 2, 'a 0.5 s chunk is padded to the minimum length');
  assert.ok(prog.at(-1) === 100 && prog.every((p, i) => i === 0 || p >= prog[i - 1]));
  await assert.rejects(transcribeChunks({ pcm, chunks: [{ start: 0, end: 2 }], modelPath: model, loader, signal: { aborted: true } }), /cancelled/);
});
