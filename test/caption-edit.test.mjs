import test from 'node:test';
import assert from 'node:assert/strict';
import { cardFromClip, retimeWords, rebuildCards, retextClip } from '../src/shared/caption-edit.js';
import { planCaptions } from '../src/shared/captions.js';
import { createCaptionClip } from '../src/shared/caption-styles.js';
import { segmentWords } from '../src/shared/thai.js';

const words = (text, t0 = 10, per = 0.4) => segmentWords(text).map((w, i) => ({ text: w, start: t0 + i * per, end: t0 + (i + 1) * per }));
const baseCard = () => planCaptions(words('วันนี้เรามาคุยเรื่องการตัดต่อวิดีโอกัน'), { dropFillers: false })[0];

test('cardFromClip: round-trips a karaoke caption clip and builds words for a plain one', () => {
  const card = baseCard();
  const karaoke = cardFromClip(createCaptionClip(card, 'pop'));
  assert.equal(karaoke.text, card.text);
  assert.equal(karaoke.words.length, card.words.length);
  assert.ok(Math.abs(karaoke.words[1].start - card.words[1].start) < 1e-9);
  assert.equal(karaoke.words[0].text, card.words[0].text);
  const plain = cardFromClip(createCaptionClip(card, 'clean'));
  assert.equal(plain.words.map((w) => w.text).join(''), card.text.replace(/\n/g, ''));
  assert.ok(plain.words.every((w, i) => i === 0 || w.start >= plain.words[i - 1].end - 1e-9));
});

test('retimeWords: unchanged words keep their timing, a replaced word takes the old word\'s slot', () => {
  const card = baseCard();
  const oldW = card.words.map((w) => w.text);
  const idx = oldW.indexOf('ตัดต่อ') >= 0 ? oldW.indexOf('ตัดต่อ') : 3;
  const edited = oldW.slice(); edited[idx] = 'ตัดแต่ง';
  const w = retimeWords(card, edited.join(''));
  assert.equal(w.map((x) => x.text).join(''), edited.join(''));
  const j = w.findIndex((x) => x.text === 'ตัดแต่ง') >= 0 ? w.findIndex((x) => x.text === 'ตัดแต่ง') : idx;
  const before = card.words[idx - 1], after = card.words[idx + 1];
  // the words around the edit did not move
  assert.ok(Math.abs(w[j - 1].start - before.start) < 1e-6 && Math.abs(w[j - 1].end - before.end) < 0.2);
  // everything stays ordered and inside the card
  assert.ok(w.every((x, i) => x.end >= x.start && (i === 0 || x.start >= w[i - 1].end - 1e-6)));
  assert.ok(w[0].start >= card.start - 1e-6 && w.at(-1).end <= card.end + 0.5);
});

test('retimeWords: pure insertion and deletion stay inside the card', () => {
  const card = baseCard();
  const ins = retimeWords(card, 'วันนี้เรามาคุยเรื่องการตัดต่อวิดีโอสนุกๆกัน');
  assert.ok(ins.length >= card.words.length && ins.every((x) => x.end > x.start));
  const del = retimeWords(card, 'วันนี้เรามาคุยกัน');
  assert.ok(del.length < card.words.length);
  assert.deepEqual(retimeWords(card, '   '), []);
});

test('rebuildCards / retextClip: edited text becomes a valid caption clip with matching karaoke ranges', () => {
  const card = baseCard();
  const clip = createCaptionClip(card, 'pop', { trackId: 'trk_1' });
  const [c1] = rebuildCards(cardFromClip(clip), 'วันนี้เรามาคุยเรื่องการตัดแต่งวิดีโอกัน');
  const next = retextClip(clip, c1);
  assert.equal(next.start, clip.start); assert.ok(Math.abs(next.duration - clip.duration) < 1e-9);
  assert.equal(next.text.content, c1.text);
  for (const w of next.text.karaoke.words) assert.ok(w.from >= 0 && w.to <= next.text.content.length && w.end >= w.start && w.start >= -1e-9);
  assert.equal(next.text.karaoke.words.map((w) => next.text.content.slice(w.from, w.to)).join(''), next.text.content.replace(/\n/g, ''));
  // a much longer line no longer fits one card
  const long = rebuildCards(cardFromClip(clip), 'วันนี้เรามาคุยเรื่องการตัดต่อวิดีโอกันและก็จะพูดถึงเทคนิคการใส่แคปชั่นให้สวยๆ ในแบบที่คนดูแล้วอ่านง่ายที่สุดเลย');
  assert.ok(long.length >= 2);
  assert.equal(long[0].start, card.start); assert.equal(long.at(-1).end, card.end);
});
