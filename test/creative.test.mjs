import test from 'node:test';
import assert from 'node:assert/strict';
import { Observer, chainDistance, motionOf } from '../src/shared/creative/observe.js';
import { inferContext } from '../src/shared/creative/context.js';
import { captureMemory, applyMemory, addMemory, removeMemory, renameMemory, shelfOf, normalizeMemory, curate, knownHashes, CURATE, MAX_MEMORIES, MAX_CURATED, KINDS } from '../src/shared/creative/still-here.js';
import { createProject, createClip, validateProject } from '../src/shared/project.js';
import { createEffect } from '../src/shared/effects-defs.js';
import { addTrack } from '../src/shared/timeline.js';
import { effectsToChain } from '../src/shared/mutation/chain.js';
import { chainHash } from '../src/shared/mutation/dna.js';

const S = 1000;
function scene() {
  const p = createProject();
  p.media.push({ id: 'm1', kind: 'video', name: 'v', path: '/x.mp4', duration: 10, width: 640, height: 360 });
  const v1 = p.tracks.find((t) => t.kind === 'video' && t.name === 'V1');
  const mk = (name, start, dur, extra = {}) => { const c = createClip({ type: 'media', mediaId: 'm1', name, start, duration: dur, trackId: v1.id, ...extra }); p.clips.push(c); return c; };
  return { p, v1, mk };
}
const grade = () => [createEffect('gradmap', { shadow: '#1a0000', mid: '#d8140f', high: '#ffe11a', contrast: 1.4 }), createEffect('grain', { amount: 0.4 }), createEffect('crt', { scan: 0.7 })];
const move = () => ({ x: [{ t: 0, v: -0.2 }, { t: 1.5, v: 0.1 }, { t: 3, v: 0.3 }], scale: [{ t: 0, v: 1 }, { t: 3, v: 1.4 }] });

test('a new project has an empty shelf and validateProject repairs a missing or wrong one', () => {
  assert.deepEqual(createProject().stillHere, []);
  const p = createProject(); delete p.stillHere; assert.deepEqual(validateProject(p).stillHere, []);
  const q = createProject(); q.stillHere = 'x'; assert.deepEqual(validateProject(q).stillHere, []);
});

// ---- Observer ----

test('observer: the first look is only a sync; edits and ends are reported afterwards', () => {
  const { p, mk } = scene();
  const c = mk('A', 0, 3, { effects: grade() });
  const o = new Observer();
  let r = o.update(p, 0);
  assert.deepEqual(r.ended, []); assert.deepEqual(r.events, []);
  c.effects[1].params.amount = 0.6; // one slider
  r = o.update(p, 5 * S);
  assert.deepEqual(r.events.map((e) => e.kind), ['effect']); assert.equal(o.look.get(c.id).edits, 1);
  c.effects = []; // cleared
  r = o.update(p, 40 * S);
  assert.equal(r.ended.length, 1);
  assert.equal(r.ended[0].kind, 'look'); assert.equal(r.ended[0].reason, 'cleared'); assert.equal(r.ended[0].edits, 1); assert.equal(r.ended[0].at - r.ended[0].born, 40 * S);
  assert.equal(effectsToChain(grade()).length, r.ended[0].data.length);
});

test('observer: swapping the look ends the old lineage and starts a new one; a small tweak does not', () => {
  const a = effectsToChain(grade()), b = structuredClone(a);
  b[1].params.amount = 0.5;
  assert.ok(chainDistance(a, b) < 0.3);
  const other = effectsToChain([createEffect('blur', { radius: 20 }), createEffect('kaleido', {})]);
  assert.ok(chainDistance(a, other) >= 0.6);
  const { p, mk } = scene();
  const c = mk('A', 0, 3, { effects: grade() });
  const o = new Observer(); o.update(p, 0);
  c.effects = [createEffect('blur', { radius: 20 }), createEffect('kaleido', {})];
  const r = o.update(p, 50 * S);
  assert.equal(r.ended.length, 1); assert.equal(r.ended[0].reason, 'replaced');
  assert.equal(o.look.get(c.id).edits, 0); assert.equal(o.look.get(c.id).born, 50 * S);
});

test('observer: deleting a clip ends its look and movement with the clip\'s name; silent updates (undo/redo/load) end nothing', () => {
  const { p, mk } = scene();
  const c = mk('Verse', 0, 3, { effects: grade(), keyframes: move() });
  const o = new Observer(); o.update(p, 0);
  p.clips = [];
  const r = o.update(p, 60 * S);
  assert.deepEqual(r.ended.map((e) => `${e.kind}:${e.reason}:${e.clipName}`).sort(), ['look:clip-removed:Verse', 'move:clip-removed:Verse']);
  assert.ok(r.events.some((e) => e.kind === 'removed'));
  const { p: p2, mk: mk2 } = scene();
  mk2('B', 0, 3, { effects: grade(), keyframes: move() });
  const o2 = new Observer(); o2.update(p2, 0);
  p2.clips = []; // as after an undo of the clip's creation
  const s = o2.update(p2, 90 * S, { silent: true });
  assert.deepEqual(s.ended, []); assert.deepEqual(s.events, []); assert.equal(o2.look.size, 0);
});

test('observer: timing, text and movement events feed the recent list (bounded)', () => {
  const { p, mk, v1 } = scene();
  const a = mk('A', 0, 3);
  const o = new Observer(); o.update(p, 0);
  a.start = 1; assert.equal(o.update(p, 1 * S).events[0].kind, 'timing');
  p.clips.push(createClip({ type: 'text', name: 'T', start: 0, duration: 2, trackId: v1.id }));
  assert.equal(o.update(p, 2 * S).events[0].kind, 'text');
  a.keyframes = move(); assert.equal(o.update(p, 3 * S).events[0].kind, 'motion');
  for (let i = 0; i < 80; i++) { a.start += 0.01; o.update(p, (4 + i) * S); }
  assert.ok(o.recent.length <= 40);
});

// ---- Creative Context ----

test('context: two clips at a cut, text over a scene, recent movement, and idle', () => {
  const { p, mk } = scene();
  const a = mk('A', 0, 3), b = mk('B', 3, 3);
  const top = addTrack(p, 'video');
  const t = createClip({ type: 'text', name: 'Title', start: 1, duration: 2, trackId: top.id }); p.clips.push(t);
  let c = inferContext({ project: p, selection: [a.id, b.id], recent: [], now: 0 });
  assert.equal(c.kind, 'connecting-scenes'); assert.deepEqual(c.clipIds, [a.id, b.id]); assert.match(c.why, /side by side/);
  c = inferContext({ project: p, selection: [t.id], recent: [], now: 0 });
  assert.equal(c.kind, 'text-over-scene');
  const recent = [{ t: 1000, kind: 'motion', clipId: a.id }];
  assert.equal(inferContext({ project: p, selection: [a.id], recent, now: 5000 }).kind, 'experimenting-motion');
  assert.equal(inferContext({ project: p, selection: [a.id], recent, now: 60000 }).kind, 'idle', 'old activity is forgotten');
  assert.equal(inferContext({ project: p, selection: [], recent: [], now: 0 }).kind, 'idle');
  assert.equal(inferContext({ project: p, selection: [b.id], recent: [{ t: 0, kind: 'effect', clipId: b.id }], now: 1000 }).kind, 'searching-look');
  assert.equal(inferContext({ project: p, selection: [], recent: [1, 2, 3].map((i) => ({ t: i, kind: 'timing', clipId: a.id })), now: 100 }).kind, 'changing-rhythm');
  assert.equal(inferContext({ project: null }).kind, 'idle');
});

// ---- capture / bring back ----

test('capture: movement, look, colours and rhythm are kept as small data (no media), and explain what is missing', () => {
  const { p, mk } = scene();
  const a = mk('A', 0, 3, { effects: grade(), keyframes: move() }), b = mk('B', 3, 3), c = mk('C', 6, 1), d = mk('D', 7, 3);
  const m = captureMemory(p, { kind: 'moved', clipIds: [a.id], now: 5 }).memory;
  assert.equal(m.kind, 'moved'); assert.equal(m.data.tracks.x[0].d, 0); assert.equal(m.data.tracks.x[2].d, 0.5); assert.equal(m.data.tracks.x[2].u, 1);
  assert.equal(captureMemory(p, { kind: 'looked', clipIds: [a.id] }).memory.data.chain.length, 3);
  assert.deepEqual(captureMemory(p, { kind: 'felt', clipIds: [a.id] }).memory.data.colors.slice(0, 3), ['#1a0000', '#d8140f', '#ffe11a']);
  const r = captureMemory(p, { kind: 'rhythm', clipIds: [a.id, b.id, c.id, d.id] }).memory;
  assert.deepEqual(r.data.intervals, [0.3, 0.3, 0.1, 0.3]);
  assert.ok(JSON.stringify(m).length < 2000);
  assert.match(captureMemory(p, { kind: 'moved', clipIds: [b.id] }).reason, /no movement/);
  assert.match(captureMemory(p, { kind: 'looked', clipIds: [b.id] }).reason, /no effects/);
  assert.match(captureMemory(p, { kind: 'felt', clipIds: [b.id] }).reason, /no effects/);
  assert.match(captureMemory(p, { kind: 'rhythm', clipIds: [a.id, b.id] }).reason, /three/);
  assert.match(captureMemory(p, { kind: 'moved', clipIds: [] }).reason, /Select/);
  assert.ok(Object.keys(KINDS).every((k) => KINDS[k].title === KINDS[k].title.toUpperCase()));
});

test('bring back: movement is relative to where the target sits, scaled to its length, clamped; one effect chain is appended; colours recolour', () => {
  const { p, mk } = scene();
  const a = mk('A', 0, 3, { effects: grade(), keyframes: move() }), t = mk('T', 3, 6);
  t.props.x = 0.5; t.props.scale = 4.8;
  const mv = captureMemory(p, { kind: 'moved', clipIds: [a.id] }).memory;
  const r = applyMemory(p, mv, { clipIds: [t.id] });
  assert.ok(r.ok);
  assert.deepEqual(t.keyframes.x.map((k) => k.t), [0, 3, 6]); // 3 s memory stretched over 6 s
  assert.equal(t.keyframes.x[0].v, 0.5); assert.equal(t.keyframes.x[2].v, 1); // 0.5 + 0.5 clamped to 1
  assert.equal(t.keyframes.scale[1].v, 5); // clamped
  const lk = captureMemory(p, { kind: 'looked', clipIds: [a.id] }).memory;
  assert.ok(applyMemory(p, lk, { clipIds: [t.id] }).ok);
  assert.equal(t.effects.length, 3); assert.notEqual(t.effects[0].id, a.effects[0].id);
  const ft = captureMemory(p, { kind: 'felt', clipIds: [a.id] }).memory;
  t.effects[0].params.shadow = '#000000';
  assert.ok(applyMemory(p, ft, { clipIds: [t.id] }).ok);
  assert.equal(t.effects[0].params.shadow, '#1a0000');
  const bare = mk('Bare', 9, 1);
  assert.match(applyMemory(p, ft, { clipIds: [bare.id] }).reason, /no colour settings/);
  assert.match(applyMemory(p, lk, { clipIds: [] }).reason, /Select/);
  for (let i = 0; i < 10; i++) t.effects.push(createEffect('grain'));
  assert.match(applyMemory(p, lk, { clipIds: [t.id] }).reason, /more than 12/);
});

test('bring back rhythm: the run keeps its span, never overlaps, never runs past the footage', () => {
  const { p, mk } = scene();
  const src = [mk('A', 0, 4), mk('B', 4, 4), mk('C', 8, 4), mk('D', 12, 4)];
  const pat = captureMemory(p, { kind: 'rhythm', clipIds: [src[0].id, src[1].id, src[2].id, src[3].id] }).memory;
  pat.data.intervals = [0.5, 0.1, 0.1, 0.3];
  const { p: q, mk: mk2 } = scene();
  const x = [mk2('X', 0, 2), mk2('Y', 2, 2), mk2('Z', 4, 2), mk2('W', 6, 2)];
  const r = applyMemory(q, pat, { clipIds: x.map((c) => c.id) });
  assert.ok(r.ok);
  const total = x.reduce((s, c) => s + c.duration, 0);
  assert.ok(total <= 8 + 1e-6);
  assert.ok(x[0].duration > x[1].duration * 3);
  for (let i = 1; i < 4; i++) assert.ok(Math.abs(x[i].start - (x[i - 1].start + x[i - 1].duration)) < 1e-6);
  const media = q.media[0]; media.duration = 1.5; // footage shorter than the wanted slot
  assert.ok(applyMemory(q, pat, { clipIds: x.map((c) => c.id) }).changed >= 0);
  assert.ok(x.every((c) => c.duration <= 1.5 + 1e-6));
  const mid = mk2('Mid', 8, 1); const gap = [x[0], mid, x[3]];
  assert.match(applyMemory(q, pat, { clipIds: gap.map((c) => c.id) }).reason || '', /between|same|already|Select/);
  assert.match(applyMemory(q, pat, { clipIds: [x[0].id] }).reason, /at least two/);
});

// ---- the shelf ----

test('shelf: no duplicates, rename/remove, bounded; kept-for-you goes first, what the user kept is never dropped', () => {
  const { p, mk } = scene();
  const a = mk('A', 0, 3, { effects: grade(), keyframes: move() });
  const mem = captureMemory(p, { kind: 'looked', clipIds: [a.id] }).memory;
  assert.ok(addMemory(p, mem).added);
  const again = addMemory(p, { ...mem, id: 'other' });
  assert.equal(again.added, false); assert.equal(again.existing.id, mem.id);
  assert.ok(renameMemory(p, mem.id, '  Smoke  ')); assert.equal(p.stillHere[0].name, 'Smoke');
  assert.ok(removeMemory(p, mem.id)); assert.equal(p.stillHere.length, 0);
  const mkFelt = (i, source, score) => { const m = captureMemory(p, { kind: 'felt', clipIds: [a.id] }).memory; m.data = { colors: [`#${(1000 + i).toString(16).padStart(6, '0')}`] }; m.source = source; m.score = score; m.id = `m${i}`; m.sig = undefined; return m; };
  for (let i = 0; i < MAX_CURATED + 3; i++) addMemory(p, mkFelt(i, 'curated', 0.5 + i / 100));
  assert.equal(p.stillHere.filter((m) => m.source === 'curated').length, MAX_CURATED);
  assert.equal(addMemory(p, mkFelt(900, 'curated', 0.1)).added, false, 'a worse one does not push out a better one');
  for (let i = 0; i < MAX_MEMORIES; i++) addMemory(p, mkFelt(2000 + i, 'user', null));
  assert.equal(p.stillHere.length, MAX_MEMORIES);
  assert.equal(p.stillHere.filter((m) => m.source === 'curated').length, 0, 'curated ones made room for the user\'s');
  assert.match(addMemory(p, mkFelt(5000, 'user', null)).reason, /full/);
  assert.equal(p.stillHere.length, MAX_MEMORIES);
});

test('normalizeMemory repairs or refuses damaged entries; shelfOf cleans a damaged shelf', () => {
  assert.equal(normalizeMemory(null), null);
  assert.equal(normalizeMemory({ id: 'x', kind: 'nope', data: {} }), null);
  assert.equal(normalizeMemory({ id: 'x', kind: 'felt', data: { colors: ['red'] } }), null);
  assert.equal(normalizeMemory({ id: 'x', kind: 'looked', data: { chain: [{ type: 'does-not-exist' }] } }), null);
  assert.equal(normalizeMemory({ id: 'x', kind: 'moved', data: { tracks: { x: [{ u: 'a', d: 1 }] } } }), null);
  const ok = normalizeMemory({ id: 'x', kind: 'moved', name: 'n'.repeat(500), thumb: 'javascript:1', data: { tracks: { x: [{ u: 2, d: 1 }, { u: 0, d: 0 }], bogus: [] } } });
  assert.equal(ok.name.length, 80); assert.equal(ok.thumb, null); assert.deepEqual(ok.data.tracks.x.map((q) => q.u), [0, 1]); assert.deepEqual(Object.keys(ok.data.tracks), ['x']);
  const { p } = scene();
  p.stillHere = [null, { id: 'a', kind: 'felt', data: { colors: ['#112233'] } }, 5];
  assert.equal(shelfOf(p).length, 1);
});

// ---- the Curator: strict ----

const ended = (o = {}) => ({ kind: 'look', clipId: 'c', clipName: 'Verse', clipType: 'media', reason: 'cleared', born: 0, at: 90 * S, edits: 8, duration: 3, data: effectsToChain(grade()), ...o });

test('curator: keeps a look that was worked on and let go; says why not otherwise', () => {
  const r = curate(ended(), { now: 90 * S });
  assert.ok(r.keep); assert.equal(r.keep.kind, 'looked'); assert.equal(r.keep.source, 'curated'); assert.ok(r.keep.score >= CURATE.minScore); assert.match(r.why, /worked on this look/);
  assert.equal(r.keep.from.clip, 'Verse');
  assert.match(curate(ended({ at: 5 * S }), {}).why, /moment/);
  assert.match(curate(ended({ edits: 1 }), {}).why, /not explored/);
  assert.match(curate(ended({ edits: 3, at: 26 * S }), {}).why, /Not enough/);
  assert.equal(curate(ended({ at: 5 * S }), {}).keep, null);
});

test('curator: does not keep defaults, disabled work, something the project or a built-in look already has, or tiny movements', () => {
  const plain = effectsToChain([createEffect('grain'), createEffect('blur')]);
  assert.match(curate(ended({ data: plain }), {}).why, /defaults/);
  const off = effectsToChain(grade()).map((e) => ({ ...e, enabled: false }));
  assert.match(curate(ended({ data: off }), {}).why, /switched on/);
  const chain = effectsToChain(grade());
  assert.match(curate(ended({ data: chain }), { known: new Set([chainHash(chain)]) }).why, /already has it/);
  const tiny = { x: [{ t: 0, v: 0 }, { t: 1, v: 0.01 }, { t: 2, v: 0.02 }] };
  assert.equal(curate(ended({ kind: 'move', data: tiny }), {}).keep, null);
  assert.match(curate(ended({ kind: 'move', data: { x: [{ t: 0, v: 0 }, { t: 1, v: 0.5 }] } }), {}).why, /Too few/);
  const big = curate(ended({ kind: 'move', data: move() }), {});
  assert.ok(big.keep); assert.equal(big.keep.kind, 'moved');
  assert.equal(curate(ended({ kind: 'move', data: move() }), { known: new Set([big.keep.sig]) }).keep, null, 'not kept twice');
});

test('knownHashes covers chains on clips, the shelf and extra hashes', () => {
  const { p, mk } = scene();
  const a = mk('A', 0, 3, { effects: grade() });
  const mem = captureMemory(p, { kind: 'felt', clipIds: [a.id] }).memory; addMemory(p, mem);
  const k = knownHashes(p, ['h1']);
  assert.ok(k.has('h1') && k.has(mem.sig) && k.has(chainHash(effectsToChain(a.effects))));
  assert.deepEqual(Object.keys(motionOf(createClip({ keyframes: { opacity: [{ t: 0, v: 1 }], x: [{ t: 0, v: 0 }] } }))), ['x']);
});
