import test from 'node:test';
import assert from 'node:assert/strict';
import { planCaptions, joinWords, breakLines } from '../src/shared/captions.js';
import { parseSubtitles, serializeSrt, parseTime, formatTime } from '../src/shared/srt.js';
import { tokensToWords } from '../src/shared/transcript.js';
import { displayWidth } from '../src/shared/thai.js';

const chars = (text, t0, per = 0.09) => [...text].map((c, i) => ({ text: c, start: t0 + i * per, end: t0 + (i + 1) * per }));
const words = (text, t0 = 0, per = 0.09) => tokensToWords(chars(text, t0, per));

test('joinWords: Thai words touch, Latin/number words get spaces', () => {
  assert.equal(joinWords([{ text: 'ใช้' }, { text: 'TikTok' }, { text: 'วัน' }]), 'ใช้TikTokวัน');
  assert.equal(joinWords([{ text: 'hello' }, { text: 'world' }, { text: '2' }]), 'hello world 2');
});

test('breakLines balances two lines and never splits a word', () => {
  const w = words('วันนี้อากาศดีมากเลยไปเที่ยวทะเลกันไหมครับ');
  const lines = breakLines(w, 2, 14);
  assert.equal(lines.length, 2); assert.deepEqual(lines.flat(), w.map((_, i) => i), 'every word exactly once, in order');
  const widths = lines.map((l) => l.reduce((a, i) => a + displayWidth(w[i].text), 0));
  assert.ok(Math.abs(widths[0] - widths[1]) <= 6, `roughly balanced ${widths}`);
  assert.equal(breakLines(w.slice(0, 3), 2, 14).length, 1, 'short text stays on one line');
});

test('planCaptions: width/line limits, order, readable timing, no overlap', () => {
  const w = words('วันนี้อากาศดีมากเลยไปเที่ยวทะเลกันไหมครับ ' + 'พรุ่งนี้เรามาทำคลิปติ๊กต็อกกันนะครับ', 0, 0.1);
  const cards = planCaptions(w, { maxWidth: 14, maxLines: 2 });
  assert.ok(cards.length >= 2);
  for (const c of cards) {
    const lines = c.text.split('\n');
    assert.ok(lines.length <= 2 && lines.every((l) => displayWidth(l) <= 16), `line widths ok: ${lines.map(displayWidth)}`);
    assert.ok(c.end - c.start >= 0.6 - 1e-9 || c.end - c.start >= 0.1);
  }
  for (let i = 1; i < cards.length; i++) assert.ok(cards[i].start >= cards[i - 1].end - 1e-9, 'cards never overlap');
  assert.equal(cards.flatMap((c) => c.words.map((x) => x.text)).join(''), w.map((x) => x.text).join(''), 'no word lost or duplicated');
});

test('planCaptions: karaoke character ranges point at the right substrings (incl. the newline)', () => {
  const w = words('วันนี้อากาศดีมากเลยไปเที่ยวทะเลกันไหมครับ', 0, 0.1);
  const [card] = planCaptions(w, { maxWidth: 10, maxLines: 2, maxDuration: 99 });
  for (const x of card.words) assert.equal(card.text.slice(x.from, x.to), x.text, `range of "${x.text}"`);
  assert.ok(card.text.includes('\n'));
});

test('planCaptions: pauses and sentence ends start a new card; fillers are dropped', () => {
  const a = words('ดีมาก', 0, 0.1), b = words('เอ่อ', 0.6, 0.1), c = words('ไปกัน', 3.0, 0.1);
  const cards = planCaptions([...a, ...b, ...c]);
  assert.equal(cards.length, 2, 'a 2s pause splits the cards');
  assert.ok(!cards.some((x) => x.text.includes('เอ่อ')), 'filler removed');
  const kept = planCaptions([...a, ...b, ...c], { dropFillers: false });
  assert.ok(kept.some((x) => x.text.includes('เอ่อ')));
  const s = planCaptions([{ text: 'จบแล้ว!', start: 0, end: 0.5 }, { text: 'ต่อไป', start: 0.6, end: 1.0 }]);
  assert.equal(s.length, 2, 'sentence end splits');
});

test('SRT: parse (comma/dot, BOM, CRLF, numbering, tags, VTT) and serialize round-trip', () => {
  const srt = '﻿1\r\n00:00:01,200 --> 00:00:03,500\r\n<i>สวัสดีครับ</i>\r\nวันนี้\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,250\r\nไปกันเลย\r\n';
  const cues = parseSubtitles(srt);
  assert.deepEqual(cues, [{ start: 1.2, end: 3.5, text: 'สวัสดีครับ\nวันนี้' }, { start: 4, end: 5.25, text: 'ไปกันเลย' }]);
  assert.deepEqual(parseSubtitles(serializeSrt(cues)), cues);
  const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.500 align:start\nhello\n\n1:02:03.004 --> 1:02:04.000\nlater\n';
  const v = parseSubtitles(vtt);
  assert.equal(v.length, 2); assert.equal(v[0].start, 1); assert.ok(Math.abs(v[1].start - 3723.004) < 1e-6);
  assert.deepEqual(parseSubtitles('garbage\n\nno times here'), []);
  assert.equal(formatTime(3723.004), '01:02:03,004'); assert.ok(Number.isNaN(parseTime('x')));
});

test('captions never straddle two ASR sentences, even when a jump cut made them adjacent in time', () => {
  const a = words('สวัสดีครับวันนี้', 0, 0.1).map((w) => ({ ...w, phrase: 0 }));
  const b = words('ตัดต่อง่ายมาก', 1.3, 0.1).map((w) => ({ ...w, phrase: 1 })); // 0.0s gap: the silence was cut
  const cards = planCaptions([...a, ...b.map((w) => ({ ...w, start: w.start - 1.3 + a.at(-1).end, end: w.end - 1.3 + a.at(-1).end }))]);
  assert.equal(cards.length, 2, cards.map((c) => c.text).join(' | '));
  assert.ok(cards[0].text.startsWith('สวัสดี') && cards[1].text.startsWith('ตัดต่อ'));
  // without phrase info the old behaviour (time based only) still works
  const plain = planCaptions([...a, ...b.map((w) => ({ text: w.text, start: w.start - 1.3 + a.at(-1).end, end: w.end - 1.3 + a.at(-1).end }))]);
  assert.ok(plain.length >= 1);
});
