import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanThai, segmentWords, displayWidth, isFiller, spokenWeight, hasThai } from '../src/shared/thai.js';
import { tokensToWords, wordsForPhrase, enforceTiming } from '../src/shared/transcript.js';

const SENTENCE = 'วันนี้อากาศดีมากเลยไปเที่ยวทะเลกันไหมครับ';
const WORDS = ['วัน', 'นี้', 'อากาศ', 'ดี', 'มาก', 'เลย', 'ไป', 'เที่ยว', 'ทะเล', 'กัน', 'ไหม', 'ครับ'];
const charTokens = (text, t0 = 0, per = 0.09) => [...text].map((c, i) => ({ text: c, start: t0 + i * per, end: t0 + (i + 1) * per }));

test('cleanThai removes zero-width, replacement chars and doubled marks, normalises whitespace', () => {
  assert.equal(cleanThai('ส​วัสดี‍  ครับ'), 'สวัสดี ครับ');
  assert.equal(cleanThai('ดี�มาก'), 'ดีมาก');
  assert.equal(cleanThai('ที่่่นี่'), 'ที่นี่', 'duplicated tone mark collapsed');
  assert.equal(cleanThai('  a \t b  '), 'a b');
  assert.ok(hasThai('hello สวัสดี') && !hasThai('hello'));
});

test('word segmentation uses the Thai dictionary and keeps punctuation with the previous word', () => {
  assert.deepEqual(segmentWords(SENTENCE), WORDS);
  assert.deepEqual(segmentWords('ดีมาก! ไปกัน...'), ['ดี', 'มาก!', 'ไป', 'กัน...']);
  assert.deepEqual(segmentWords('ใช้ TikTok 2 วัน'), ['ใช้', 'TikTok', '2', 'วัน']);
  assert.deepEqual(segmentWords('   '), []);
});

test('display width ignores combining marks (tone marks and above/below vowels)', () => {
  assert.equal(displayWidth('สวัสดี'), 4);
  assert.equal(displayWidth('ที่รัก'), 3);
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('ก็'), 1);
});

test('fillers and spoken weight', () => {
  assert.ok(isFiller('เอ่อ') && isFiller('อืม,') && !isFiller('ดี'));
  assert.ok(spokenWeight('ที่') === 1 && spokenWeight('อากาศ') >= 4 && spokenWeight('!!') === 1);
});

test('character-level tokens (faster-whisper style) are re-assembled into real words with correct times', () => {
  const tokens = charTokens(SENTENCE, 1.0, 0.09);
  const words = tokensToWords(tokens);
  assert.deepEqual(words.map((w) => w.text), WORDS);
  assert.ok(Math.abs(words[0].start - 1.0) < 1e-9, 'first word starts at the first token');
  assert.ok(Math.abs(words.at(-1).end - (1.0 + SENTENCE.length * 0.09)) < 1e-6, 'last word ends at the last token');
  for (let i = 1; i < words.length; i++) assert.ok(words[i].start >= words[i - 1].end - 1e-9 && words[i].end > words[i].start, 'monotonic');
  // "อากาศ" is chars 5..9: starts at the time of its first character
  const k = SENTENCE.indexOf('อากาศ');
  assert.ok(Math.abs(words[2].start - (1.0 + k * 0.09)) < 1e-6);
});

test('tokens that split a syllable mid-cluster give exactly the same words as whole-word tokens', () => {
  const fine = tokensToWords(charTokens(SENTENCE, 0, 0.1));
  const coarse = tokensToWords([{ text: SENTENCE, start: 0, end: SENTENCE.length * 0.1 }]);
  assert.deepEqual(fine.map((w) => w.text), coarse.map((w) => w.text));
  for (let i = 0; i < fine.length; i++) assert.ok(Math.abs(fine[i].start - coarse[i].start) < 0.11, `word ${i} timing agrees`);
});

test('spaces are phrase boundaries: a word never spans a space; special tokens and replacement chars are dropped', () => {
  const tokens = [{ text: '[_BEG_]', start: 0, end: 0 }, { text: 'ดีมาก', start: 0, end: 0.5 }, { text: ' ', start: 0.5, end: 0.6 }, { text: 'ไปกัน�', start: 0.6, end: 1.1 }, { text: '[BLANK_AUDIO]', start: 1.1, end: 2 }];
  const w = tokensToWords(tokens);
  assert.deepEqual(w.map((x) => x.text), ['ดี', 'มาก', 'ไป', 'กัน']);
  assert.ok(w[2].start >= 0.6 - 1e-9 && w.every((x) => !/\s/.test(x.text)));
});

test('enforceTiming: monotonic, minimum duration, no overlap', () => {
  const w = enforceTiming([{ text: 'a', start: 1, end: 1 }, { text: 'b', start: 0.9, end: 0.95 }, { text: 'c', start: 2, end: 1.5 }], 0.08);
  for (let i = 0; i < w.length; i++) { assert.ok(w[i].end >= w[i].start); if (i) assert.ok(w[i].start >= w[i - 1].end - 1e-9); }
  assert.ok(w[0].end - w[0].start >= 0.08 - 1e-9);
});

test('wordsForPhrase spreads words over the voiced part only (energy envelope), never into a pause', () => {
  const rate = 100, rms = new Float32Array(400).fill(0.5);
  for (let i = 150; i < 250; i++) rms[i] = 0; // 1.5s..2.5s silence inside the phrase
  const w = wordsForPhrase(SENTENCE, 0, 4, { rate, rms });
  assert.deepEqual(w.map((x) => x.text), WORDS);
  const inPause = w.filter((x) => x.start > 1.55 && x.start < 2.45);
  assert.equal(inPause.length, 0, 'no word starts inside the pause');
  assert.ok(w.some((x) => x.start >= 2.5 - 1e-6), 'speech resumes after the pause');
  const flat = wordsForPhrase(SENTENCE, 0, 4, null);
  assert.ok(Math.abs(flat.at(-1).end - 4) < 1e-6 && Math.abs(flat[0].start) < 1e-6, 'no envelope -> proportional over the whole phrase');
});

test('real faster-whisper output (fixture): fragments become words inside their segments, monotonic', () => {
  const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/whisper-th-tokens.json', import.meta.url), 'utf8'));
  assert.equal(fx.segments.length, 3);
  for (const s of fx.segments) {
    const words = tokensToWords(s.words);
    assert.ok(words.length >= 5 && words.length < s.words.length, `fewer, longer pieces than raw tokens (${words.length} vs ${s.words.length})`);
    assert.ok(words[0].start >= s.start - 0.01 && words.at(-1).end <= s.end + 0.2, 'stays inside the segment');
    for (let i = 0; i < words.length; i++) { assert.ok(words[i].text.length > 0 && !/\s/.test(words[i].text)); if (i) assert.ok(words[i].start >= words[i - 1].end - 1e-9); }
    // a standalone tone mark / vowel must never start a word (it would render detached)
    for (const w of words) assert.ok(!/^[ัิ-ฺ็-๎]/.test(w.text), `no word starts with a combining mark: ${w.text}`);
  }
  // pauses between the phrases survive: a >=1s gap exists between segment 1 and 2 words
  const all = fx.segments.flatMap((s) => tokensToWords(s.words));
  const gaps = all.slice(1).map((w, i) => w.start - all[i].end).filter((g) => g > 0.9);
  assert.ok(gaps.length >= 2, `both 1.2s silences visible as gaps: ${gaps.map((g) => g.toFixed(2))}`);
});
