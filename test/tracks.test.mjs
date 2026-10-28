import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/shared/project.js';
import { addTrack, moveTrack, removeEmptyTrack, activeVisualClips, addClipRaw } from '../src/shared/timeline.js';
import { createClip } from '../src/shared/project.js';

const names = (p) => p.tracks.map((t) => t.name).join(',');

test('moveTrack: audio can go above video and back, any mix, clamped', () => {
  const p = createProject();
  const [a1, a2] = [p.tracks.find((t) => t.kind === 'audio'), p.tracks.filter((t) => t.kind === 'audio')[1]];
  assert.ok(a1 && a2);
  const before = names(p);
  assert.equal(moveTrack(p, a2.id, 0), true);
  assert.equal(p.tracks[0].id, a2.id, 'the audio row is now first');
  assert.equal(p.tracks.length, 4);
  assert.equal(moveTrack(p, a2.id, 0), false, 'no-op reports false');
  moveTrack(p, a2.id, 99);
  assert.equal(p.tracks.at(-1).id, a2.id, 'index is clamped to the last row');
  assert.equal(moveTrack(p, 'nope', 1), false);
  assert.equal(names(p), before, 'moved up then back down restores the original order');
});

test('moving an audio row never changes which video draws on top; moving a video row does', () => {
  const p = createProject();
  const [v1, v2] = p.tracks.filter((t) => t.kind === 'video');
  const lo = createClip({ type: 'text', name: 'lo', start: 0, duration: 4, trackId: v2.id });
  const hi = createClip({ type: 'text', name: 'hi', start: 0, duration: 4, trackId: v1.id });
  p.clips.push(lo, hi);
  const topmost = () => activeVisualClips(p, 1).at(-1).name;
  assert.equal(topmost(), 'hi', 'the upper row draws last (on top)');
  moveTrack(p, p.tracks.find((t) => t.kind === 'audio').id, 0);
  assert.equal(topmost(), 'hi', 'audio reorder leaves the picture alone');
  moveTrack(p, v1.id, p.tracks.length - 1);
  assert.equal(topmost(), 'lo', 'sending the video row to the bottom puts it under the other');
});

test('removeEmptyTrack only removes empty rows and keeps the last of each kind', () => {
  const p = createProject();
  const extra = addTrack(p, 'video');
  assert.equal(removeEmptyTrack(p, extra.id), true);
  const only = p.tracks.filter((t) => t.kind === 'video');
  for (const t of only.slice(1)) removeEmptyTrack(p, t.id);
  const last = p.tracks.find((t) => t.kind === 'video');
  assert.equal(removeEmptyTrack(p, last.id), false, 'the last video row stays');
  const busy = addTrack(p, 'video');
  addClipRaw(p, createClip({ type: 'text', trackId: busy.id, start: 0, duration: 1 }));
  assert.equal(removeEmptyTrack(p, busy.id), false, 'a row with clips stays');
});
