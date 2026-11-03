import test from 'node:test';
import assert from 'node:assert/strict';
import { planAdlibs, DEFAULT_ADLIBS } from '../src/shared/adlibs.js';
import { createProject } from '../src/shared/project.js';
import { addMediaClip, stutterAt, sourceTimeAt, clipEnd } from '../src/shared/timeline.js';

const beats = Array.from({ length: 32 }, (_, i) => 1 + i * 0.5); // 120 BPM from 1 s

test('ad-libs: every Nth beat, inside the window, short enough to clear the next one, never the same word twice in a row', () => {
  const plan = planAdlibs(beats, { words: ['yeah!', 'x2', 'what?'], every: 4, seed: 5 });
  assert.equal(plan.length, 8);
  assert.deepEqual(plan.map((a) => a.t), beats.filter((_, i) => i % 4 === 0));
  for (let i = 0; i < plan.length; i++) {
    assert.ok(plan[i].duration >= 0.08 && plan[i].duration <= 0.45 + 1e-9);
    if (i) { assert.notEqual(plan[i].word, plan[i - 1].word); assert.ok(plan[i - 1].t + plan[i - 1].duration <= plan[i].t); }
    assert.ok(Math.abs(plan[i].x) >= 0.1 && Math.abs(plan[i].x) <= 0.3 && Math.abs(plan[i].y) <= 0.25 && Math.abs(plan[i].rotation) <= 11);
  }
  assert.deepEqual(planAdlibs(beats, { words: ['a', 'b'], every: 4, seed: 5 }), planAdlibs(beats, { words: ['a', 'b'], every: 4, seed: 5 }), 'same seed, same plan');
  const win = planAdlibs(beats, { every: 1, start: 4, end: 6 });
  assert.deepEqual(win.map((a) => a.t), [4, 4.5, 5, 5.5]);
  assert.ok(win.slice(0, -1).every((a) => a.duration <= 0.5 * 0.85 + 1e-9), 'closely spaced beats get shorter pops');
  assert.deepEqual(planAdlibs([], {}), []); assert.deepEqual(planAdlibs(beats, { words: [' ', ''] }), []);
  assert.ok(DEFAULT_ADLIBS.length >= 5);
});

function clip6() {
  const p = createProject(); p.media.push({ id: 'm', kind: 'video', duration: 30, hasAudio: true, name: 'v', path: '/v.mp4' });
  const c = addMediaClip(p, 'm', p.tracks.find((t) => t.kind === 'video').id, 0); c.duration = 6; c.in = 3; c.fadeIn = 0.5; c.fadeOut = 0.5;
  const next = addMediaClip(p, 'm', c.trackId, 6); next.in = 20; next.duration = 2;
  return { p, c, next };
}

test('stutter: the slice plays `repeats` times from the same piece of source, the rest of the clip and later clips slide later', () => {
  const { p, c, next } = clip6();
  const r = stutterAt(p, c.id, 2, 0.25, 4);
  assert.equal(r.parts.length, 4);
  assert.ok(Math.abs(r.extra - 0.75) < 1e-9);
  const starts = r.parts.map((x) => x.start);
  assert.deepEqual(starts.map((s) => +s.toFixed(4)), [2, 2.25, 2.5, 2.75]);
  for (const part of r.parts) { assert.ok(Math.abs(part.duration - 0.25) < 1e-9); assert.ok(Math.abs(part.in - 5) < 1e-9, 'every copy shows source 5 s'); }
  const track = p.clips.filter((x) => x.trackId === c.trackId).sort((a, b) => a.start - b.start);
  assert.equal(track.length, 7, 'head, 4 loops, tail, and the following clip');
  const tail = track[track.length - 2];
  assert.ok(Math.abs(tail.start - 3) < 1e-9 && Math.abs(sourceTimeAt(tail, 3) - 5.25) < 1e-9, 'the clip carries on right after the loop, where the loop began plus one slice');
  assert.ok(Math.abs(next.start - 6.75) < 1e-9, 'later clips moved by the extra time');
  for (let i = 1; i < track.length; i++) assert.ok(clipEnd(track[i - 1]) <= track[i].start + 1e-9, 'no overlaps');
  assert.equal(r.parts[1].fadeIn, 0);
  assert.equal(track[0].fadeIn, 0.5, 'the original fade-in stays on the head'); assert.equal(track[0].fadeOut, 0); assert.equal(tail.fadeIn, 0); assert.equal(tail.fadeOut, 0.5, 'and the fade-out on the tail');
});

test('stutter at the very start of a clip, and refusing impossible requests', () => {
  const { p, c } = clip6();
  const r = stutterAt(p, c.id, 0, 0.5, 2);
  assert.equal(r.parts.length, 2); assert.ok(Math.abs(r.parts[0].in - 3) < 1e-9);
  const q = clip6();
  assert.equal(stutterAt(q.p, q.c.id, 5.9, 0.5, 4), null, 'slice runs past the end');
  assert.equal(stutterAt(q.p, q.c.id, 1, 0.01, 4), null, 'slice too short');
  assert.equal(stutterAt(q.p, q.c.id, 1, 0.25, 1), null, 'one play is no stutter');
  assert.equal(stutterAt(q.p, 'nope', 1, 0.25, 4), null);
});
