import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProfile, recordEvent, cleanProfile, weights, fit, summarize, confident, MIN_EVENTS, MIN_SCORE, HALF_LIFE_DAYS, MAX_ITEMS, effectOf } from '../src/shared/taste/taste.js';

const DAY = 86400000, T0 = 1_700_000_000_000;
const rec = (p, kind, tags, at = T0) => recordEvent(p, { kind, tags, at });

test('keeping, cancelling and regretting move the numbers the right way and never change the old profile', () => {
  const p0 = emptyProfile();
  const p1 = rec(p0, 'applied', ['fx:grain', 'fx:bloom']);
  assert.deepEqual(p0, emptyProfile(), 'the old profile is untouched');
  const w1 = weights(p1, T0); assert.ok(w1['fx:grain'] > 0 && w1['fx:bloom'] > 0);
  const p2 = rec(p1, 'cancelled', ['fx:bloom']); assert.ok(weights(p2, T0)['fx:bloom'] < w1['fx:bloom'], 'cancelling lowers it');
  const p3 = rec(p1, 'regret', ['fx:bloom']); assert.ok(weights(p3, T0)['fx:bloom'] < weights(p2, T0)['fx:bloom'], 'an immediate Undo says more than a Cancel');
  assert.ok(weights(p3, T0)['fx:bloom'] < 0, 'applied then undone at once ends up on the "no" side');
  assert.deepEqual(p3.counts, { applied: 1, cancelled: 0, regret: 1 }); assert.equal(p3.events, 2);
});

test('it fades: after one half-life a weight is half, so a changed taste takes over', () => {
  const p = rec(emptyProfile(), 'applied', ['fx:vhs']);
  const now = weights(p, T0)['fx:vhs'], later = weights(p, T0 + HALF_LIFE_DAYS * DAY)['fx:vhs'];
  assert.ok(Math.abs(Math.atanh(later) * 2 - Math.atanh(now) * 2 / 2) < 1e-9, 'the raw weight halves');
  let q = p; for (let i = 0; i < 4; i++) q = rec(q, 'cancelled', ['fx:vhs'], T0 + 200 * DAY); assert.ok(weights(q, T0 + 200 * DAY)['fx:vhs'] < 0, 'recent dislikes beat an old like');
});

test('silent until it has seen enough; then a reading fits or not, with the reasons', () => {
  let p = emptyProfile();
  assert.equal(fit(p, ['fx:grain'], T0), null); assert.equal(confident(p), false);
  for (let i = 0; i < MIN_EVENTS - 1; i++) p = rec(p, 'applied', ['fx:grain', 'fx:bloom']);
  assert.equal(fit(p, ['fx:grain'], T0), null, 'one event short of an opinion');
  p = rec(p, 'applied', ['fx:grain', 'fx:bloom']); for (let i = 0; i < 3; i++) p = rec(p, 'cancelled', ['fx:vhs']);
  const good = fit(p, ['fx:grain', 'fx:bloom'], T0), bad = fit(p, ['fx:vhs', 'fx:grain'], T0), unknown = fit(p, ['fx:crt'], T0);
  assert.ok(good.score >= MIN_SCORE && good.liked.length === 2 && good.disliked.length === 0);
  assert.ok(bad.score < good.score && bad.disliked.includes('fx:vhs') && bad.liked.includes('fx:grain'));
  assert.equal(unknown, null, 'an effect it has never seen gets no opinion');
  const many = fit(p, ['fx:grain', 'fx:crt', 'fx:blur', 'fx:glitch', 'fx:noise'], T0);
  assert.ok(many.score >= MIN_SCORE, `effects it knows nothing about do not dilute what it does know (${many.score})`);
  assert.ok(fit(p, ['fx:grain', 'fx:bloom'], T0).score > fit(p, ['fx:grain'], T0).score, 'more liked effects fit better');
});

test('summary lists the strongest likes and dislikes only, at most five each, strongest first', () => {
  let p = emptyProfile();
  for (const t of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) for (let i = 0; i < 7 - 'abcdefg'.indexOf(t); i++) p = rec(p, 'applied', [`fx:${t}`]);
  for (const t of ['x', 'y']) for (let i = 0; i < 4; i++) p = rec(p, 'regret', [`fx:${t}`]);
  p = rec(p, 'applied', ['fx:faint']); // one weak event: below the 0.25 line
  const s = summarize(p, T0);
  assert.equal(s.likes.length, 5); assert.deepEqual(s.likes.map((r) => r.tag), ['fx:a', 'fx:b', 'fx:c', 'fx:d', 'fx:e']); assert.deepEqual(s.dislikes.map((r) => r.tag).sort(), ['fx:x', 'fx:y']);
  assert.equal(s.confident, true); assert.equal(effectOf('fx:grain'), 'grain'); assert.equal(effectOf('vibe:x'), null);
});

test('bad input is refused or repaired: unknown event kinds, junk tags, wrong shapes, too many items', () => {
  const p = emptyProfile();
  assert.equal(rec(p, 'loved', ['fx:a']), p); assert.equal(rec(p, 'applied', []), p); assert.equal(rec(p, 'applied', ['Not OK!', '<x>']), p); assert.equal(recordEvent(p, { kind: 'applied', tags: ['fx:a'], at: NaN }), p); assert.equal(recordEvent(p, null), p);
  for (const junk of [null, 5, 'x', [], { v: 99 }, { v: 1 }, { v: 1, items: null }]) assert.deepEqual(cleanProfile(junk), emptyProfile(), JSON.stringify(junk));
  const messy = cleanProfile({ v: 1, events: -3, counts: { applied: 'x' }, items: { 'fx:ok': { w: 1, t: T0, n: 2 }, 'BAD TAG': { w: 1, t: T0, n: 1 }, 'fx:nan': { w: NaN, t: T0, n: 1 }, 'fx:str': 'x' } });
  assert.deepEqual(Object.keys(messy.items), ['fx:ok']); assert.equal(messy.events, 0); assert.equal(messy.counts.applied, 0);
  let big = emptyProfile(); for (let i = 0; i < MAX_ITEMS + 40; i++) big = rec(big, 'applied', [`fx:t${i}`], T0 + i);
  assert.ok(Object.keys(big.items).length <= MAX_ITEMS);
  assert.deepEqual(cleanProfile(JSON.parse(JSON.stringify(big))).items, big.items, 'it survives being saved and loaded');
});
