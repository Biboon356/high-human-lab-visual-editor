import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/shared/project.js';
import { addMediaClip, addTrack, dissolveInto, clipEnd, overlaps, clipsOnTrack } from '../src/shared/timeline.js';

function setup() {
  const p = createProject();
  p.media.push({ id: 'm1', kind: 'video', name: 'a.mp4', duration: 20, width: 640, height: 360, hasAudio: true }, { id: 'm2', kind: 'video', name: 'b.mp4', duration: 20, width: 640, height: 360, hasAudio: true },
    { id: 'img', kind: 'image', name: 'p.png', duration: 0, width: 640, height: 360 });
  const v1 = p.tracks.find((t) => t.name === 'V1');
  return { p, v1 };
}
const noOverlaps = (p) => { for (const t of p.tracks) { const cs = clipsOnTrack(p, t.id).sort((a, b) => a.start - b.start); for (let i = 1; i < cs.length; i++) assert.ok(cs[i].start >= clipEnd(cs[i - 1]) - 1e-6, `overlap on ${t.name}`); } };

test('dissolveInto: incoming clip overlaps the outgoing one, fades in on a track directly above, content stays in sync', () => {
  const { p, v1 } = setup();
  const a = addMediaClip(p, 'm1', v1.id, 0); a.duration = 5; a.in = 2;
  const b = addMediaClip(p, 'm2', v1.id, 5); b.duration = 5; b.in = 4;
  const r = dissolveInto(p, b.id, 1);
  assert.ok(r && Math.abs(r.seconds - 1) < 1e-9);
  assert.equal(b.start, 4); assert.equal(b.duration, 6); assert.equal(b.in, 3, 'source time at the original cut is unchanged');
  assert.equal(b.fadeIn, 1); assert.equal(a.fadeOut || 0, 0);
  const idx = (id) => p.tracks.findIndex((t) => t.id === id);
  assert.equal(idx(b.trackId), idx(v1.id) - 1, 'directly above the outgoing track');
  assert.match(p.tracks[idx(b.trackId)].name, /\+$/);
  assert.ok(Math.abs(clipEnd(a) - 5) < 1e-9 && Math.abs(clipEnd(b) - 10) < 1e-9);
  noOverlaps(p);
});

test('dissolveInto: a chain alternates — the next dissolve fades the upper clip OUT over the lower one', () => {
  const { p, v1 } = setup();
  const a = addMediaClip(p, 'm1', v1.id, 0); a.duration = 4; a.in = 1;
  const b = addMediaClip(p, 'm2', v1.id, 4); b.duration = 4; b.in = 3;
  const c = addMediaClip(p, 'm1', v1.id, 8); c.duration = 4; c.in = 8;
  assert.ok(dissolveInto(p, b.id, 0.5)); assert.ok(dissolveInto(p, c.id, 0.5));
  const idx = (id) => p.tracks.findIndex((t) => t.id === id);
  assert.ok(idx(b.trackId) < idx(c.trackId), 'b is above c');
  assert.equal(b.fadeOut, 0.5, 'b (on top) fades out into c'); assert.equal(c.fadeIn || 0, 0);
  assert.equal(c.start, 7.5);
  noOverlaps(p);
});

test('dissolveInto: uses the outgoing tail when the incoming clip has no head room; stills work; nothing to dissolve returns null', () => {
  const { p, v1 } = setup();
  const a = addMediaClip(p, 'm1', v1.id, 0); a.duration = 4; a.in = 2;
  const b = addMediaClip(p, 'm2', v1.id, 4); b.duration = 4; b.in = 0;
  const r = dissolveInto(p, b.id, 0.5);
  assert.ok(r); assert.equal(b.start, 4, 'incoming keeps its start'); assert.equal(a.duration, 4.5, 'outgoing runs on underneath'); assert.equal(b.in, 0);
  noOverlaps(p);
  const { p: q, v1: w } = setup();
  const x = addMediaClip(q, 'm1', w.id, 0); x.duration = 3; const s = addMediaClip(q, 'img', w.id, 3); s.duration = 3;
  const rr = dissolveInto(q, s.id, 0.5); assert.ok(rr && s.start === 2.5 && s.in === 0);
  assert.equal(dissolveInto(q, x.id, 0.5), null, 'the first clip has nothing before it');
  const lone = addMediaClip(q, 'm2', w.id, 20); assert.equal(dissolveInto(q, lone.id, 0.5), null, 'not adjacent to anything');
  const tooShort = addMediaClip(q, 'm2', w.id, 6.5); tooShort.duration = 0.1; assert.equal(dissolveInto(q, tooShort.id, 0.5), null);
});

test('dissolveInto: keyframes move with the clip so animation stays in sync', () => {
  const { p, v1 } = setup();
  const a = addMediaClip(p, 'm1', v1.id, 0); a.duration = 4; a.in = 1;
  const b = addMediaClip(p, 'm2', v1.id, 4); b.duration = 4; b.in = 5; b.keyframes = { scale: [{ t: 0, v: 1 }, { t: 2, v: 1.5 }] };
  dissolveInto(p, b.id, 1);
  assert.deepEqual(b.keyframes.scale.map((k) => k.t), [1, 3]);
});
