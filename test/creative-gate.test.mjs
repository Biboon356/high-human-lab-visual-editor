import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, GATE, newStats, thresholdFor, recordShown, recordDismissed, recordApplied, cleanStats } from '../src/shared/creative/gate.js';
import { suggestFor, paletteAffinity } from '../src/shared/creative/suggest.js';
import { inferContext } from '../src/shared/creative/context.js';
import { createProject, createClip } from '../src/shared/project.js';
import { createEffect } from '../src/shared/effects-defs.js';
import { captureMemory, addMemory } from '../src/shared/creative/still-here.js';

function scene() {
  const p = createProject();
  p.media.push({ id: 'm1', kind: 'video', name: 'v', path: '/x.mp4', duration: 20, width: 640, height: 360 });
  const v1 = p.tracks.find((t) => t.kind === 'video' && t.name === 'V1');
  const mk = (name, start, dur, extra = {}) => { const c = createClip({ type: 'media', mediaId: 'm1', name, start, duration: dur, trackId: v1.id, ...extra }); p.clips.push(c); return c; };
  return { p, mk };
}
const ctxOf = (p, ids, recent = [], now = 0) => inferContext({ project: p, selection: ids, recent, now });
const T = 100000;
const state = (c, over = {}) => ({ now: T, enabled: true, context: { kind: 'connecting-scenes', clipIds: c.clipIds }, selection: c.clipIds, playing: false, busy: false, typing: false, lastEditAt: T - 10000, active: false, lastShownAt: -Infinity, cooldowns: {}, stats: newStats(), ...over });
const cand = (over = {}) => ({ key: 'k', kind: 'relate', contexts: ['connecting-scenes'], clipIds: ['a', 'b'], confidence: 0.75, line: 'The first shot moves and this one stays still.', ...over });

test('gate: a good candidate in a quiet moment passes; every condition on its own can silence it', () => {
  const c = cand();
  assert.deepEqual(evaluate(c, state(c)), { pass: true, failed: [] });
  const fail = (over, c2 = c) => evaluate(c2, state(c2, over)).failed;
  assert.deepEqual(fail({ enabled: false }), ['off']);
  assert.deepEqual(fail({ stats: { ...newStats(), mutedUntil: T + 1 } }), ['off']);
  assert.deepEqual(fail({ context: { kind: 'idle', clipIds: [] }, selection: [] }), ['relevance']);
  assert.deepEqual(fail({ selection: ['zzz'], context: { kind: 'connecting-scenes', clipIds: ['zzz'] } }), ['relevance']);
  assert.deepEqual(evaluate(cand({ confidence: 0.5 }), state(c)).failed, ['confidence']);
  assert.deepEqual(fail({ cooldowns: { k: T + 1 } }), ['novelty']);
  assert.equal(evaluate(c, state(c, { cooldowns: { k: T } })).pass, true, 'a finished cooldown no longer blocks');
  for (const over of [{ playing: true }, { busy: true }, { typing: true }, { active: true }, { lastEditAt: T - 500 }, { lastShownAt: T - 1000 }]) assert.deepEqual(fail(over), ['interruption'], JSON.stringify(over));
  assert.deepEqual(evaluate(cand({ line: '' }), state(c)).failed, ['explainability']);
  assert.deepEqual(evaluate(cand({ line: 'x'.repeat(GATE.maxLine + 1) }), state(c)).failed, ['explainability']);
  assert.ok(evaluate(cand({ confidence: 0.1, line: '' }), state(c, { playing: true })).failed.length >= 3, 'all failures are reported');
});

test('gate: the bar rises when suggestions are dismissed, and muting follows near-constant dismissal', () => {
  let s = newStats();
  assert.equal(thresholdFor(s), GATE.minConfidence);
  for (let i = 0; i < 4; i++) s = recordDismissed(recordShown(s), T);
  assert.equal(thresholdFor(s), GATE.minConfidence, 'not enough history to judge yet');
  s = recordShown(s); // 5 shown, 4 dismissed
  assert.ok(thresholdFor(s) > 0.85 && thresholdFor(s) < 0.95);
  assert.equal(evaluate(cand({ confidence: 0.8 }), state(cand(), { stats: s })).failed.includes('confidence'), true, 'a once-good candidate is now not good enough');
  assert.equal(s.mutedUntil, 0);
  s = recordDismissed(recordShown(s), T); // 6 shown, 5 dismissed
  assert.equal(s.mutedUntil, T + GATE.muteMs);
  let applied = newStats(); for (let i = 0; i < 6; i++) applied = recordApplied(recordShown(applied));
  assert.equal(thresholdFor(applied), GATE.minConfidence, 'applying them keeps the bar where it is');
  assert.deepEqual(cleanStats({ shown: -3, dismissed: 'x', applied: 2.7, mutedUntil: 5 }), { shown: 0, dismissed: 0, applied: 2, mutedUntil: 5 });
  assert.deepEqual(cleanStats(null), newStats());
});

test('suggest: only what is true of these clips, and only when it can be applied', () => {
  const { p, mk } = scene();
  const a = mk('A', 0, 3), b = mk('B', 3, 3);
  assert.deepEqual(suggestFor({ project: p, context: ctxOf(p, [a.id, b.id]) }), [], 'two plain clips: silence');
  a.keyframes = { x: [{ t: 0, v: -0.3 }, { t: 3, v: 0.3 }] };
  let s = suggestFor({ project: p, context: ctxOf(p, [a.id, b.id]) });
  assert.deepEqual(s.map((x) => [x.relation, x.heading]), [['follow', 'LET IT FLOW']]);
  assert.deepEqual(s[0].clipIds, [a.id, b.id]); assert.ok(s[0].line.length <= GATE.maxLine);
  a.effects.push(createEffect('veins')); // growth on A that stops at the cut
  s = suggestFor({ project: p, context: ctxOf(p, [b.id, a.id]) });
  assert.deepEqual(s.map((x) => x.relation), ['grow', 'follow'], 'most confident first, whichever way they were selected');
  b.effects.push(createEffect('veins')); a.keyframes = {};
  assert.deepEqual(suggestFor({ project: p, context: ctxOf(p, [a.id, b.id]) }), [], 'B already has it');
  a.effects = [createEffect('glitch', { amount: 0.9 }), createEffect('vhs', { amount: 0.9 })]; b.effects = [createEffect('blur', { radius: 25 }), createEffect('kaleido')];
  assert.deepEqual(suggestFor({ project: p, context: ctxOf(p, [a.id, b.id]) }).map((x) => x.relation), ['become']);
  assert.deepEqual(suggestFor({ project: p, context: { kind: 'idle', clipIds: [], why: '' } }), []);
  assert.deepEqual(suggestFor({ project: null, context: {} }), []);
});

test('suggest: LOOK BACK offers at most three similar-but-different looks from the shelf, never an exact repeat or something unrelated', () => {
  const { p, mk } = scene();
  const old = mk('Old', 0, 3, { effects: [createEffect('glitch', { amount: 0.9 }), createEffect('vhs', { amount: 0.8 }), createEffect('grain', { amount: 0.5 })] });
  const cur = mk('Now', 3, 3, { effects: [createEffect('glitch', { amount: 0.2 }), createEffect('vhs', { amount: 0.2 }), createEffect('grain', { amount: 0.1 })] });
  const unrelated = mk('Other', 6, 3, { effects: [createEffect('kaleido'), createEffect('blur', { radius: 20 })] });
  for (const c of [old, unrelated]) addMemory(p, captureMemory(p, { kind: 'looked', clipIds: [c.id], now: 1 }).memory);
  const ctx = { kind: 'searching-look', clipIds: [cur.id], why: '' };
  const s = suggestFor({ project: p, context: ctx, shelf: p.stillHere });
  assert.equal(s.length, 1); assert.equal(s[0].kind, 'lookback'); assert.equal(s[0].items.length, 1); assert.equal(s[0].items[0].name, 'Old');
  assert.ok(s[0].confidence >= 0.7);
  assert.deepEqual(suggestFor({ project: p, context: { kind: 'searching-look', clipIds: [old.id] }, shelf: p.stillHere }), [], 'a look identical to the memory is not "something like it"');
  assert.deepEqual(suggestFor({ project: p, context: ctx, shelf: [] }), []);
  for (let i = 0; i < 5; i++) { const m = structuredClone(p.stillHere[0]); m.id = `x${i}`; m.data.chain[0].params.amount = 0.5 + i * 0.1; m.sig = `s${i}`; p.stillHere.push(m); }
  assert.equal(suggestFor({ project: p, context: ctx, shelf: p.stillHere })[0].items.length, 3, 'never more than three');
  // motion
  cur.keyframes = { x: [{ t: 0, v: 0 }, { t: 1, v: 0.1 }] };
  const mover = mk('Mover', 9, 3, { keyframes: { x: [{ t: 0, v: 0 }, { t: 3, v: 0.5 }] } });
  addMemory(p, captureMemory(p, { kind: 'moved', clipIds: [mover.id], now: 1 }).memory);
  const mv = suggestFor({ project: p, context: { kind: 'experimenting-motion', clipIds: [cur.id] }, shelf: p.stillHere });
  assert.equal(mv.length, 1); assert.equal(mv[0].items[0].kind, 'moved');
});

test('paletteAffinity: a gentle preference for colours near the project palette', () => {
  const m = { data: { colors: ['#ff0000'] } };
  assert.ok(paletteAffinity(m, ['#ff1010']) > 0.9);
  assert.ok(paletteAffinity(m, ['#00ffff']) < 0.1);
  assert.equal(paletteAffinity(m, []), 0); assert.equal(paletteAffinity({ data: {} }, ['#ff0000']), 0);
});
