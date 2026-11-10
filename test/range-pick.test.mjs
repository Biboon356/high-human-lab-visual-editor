import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createClip } from '../src/shared/project.js';
import { activeRange, markRange, projectDuration } from '../src/shared/timeline.js';
import { buildAudioGraph, buildExportArgs } from '../src/shared/export-plan.js';
import { mediaBox, inBox, boxCenter, alphaBox, snapToCentre } from '../src/shared/pick.js';

const withClip = (len = 10) => {
  const p = createProject();
  p.media.push({ id: 'm', kind: 'video', name: 'a.mp4', path: '/a.mp4', duration: len, width: 1920, height: 1080, hasAudio: true });
  p.clips.push(createClip({ type: 'media', mediaId: 'm', trackId: p.tracks.find((t) => t.kind === 'video').id, start: 0, duration: len }));
  p.clips.push(createClip({ type: 'media', mediaId: 'm', trackId: p.tracks.find((t) => t.kind === 'audio').id, start: 0, duration: len }));
  return p;
};

test('markRange: In/Out default the other end, never invert, clamp to the project', () => {
  const p = withClip(10);
  assert.equal(activeRange(p), null);
  markRange(p, 'in', 2);
  assert.deepEqual(activeRange(p), { in: 2, out: 10 });
  markRange(p, 'out', 7);
  assert.deepEqual(activeRange(p), { in: 2, out: 7 });
  markRange(p, 'in', 9);                                   // past the Out: the Out is pushed, the range stays valid
  const r = activeRange(p); assert.ok(r && r.out - r.in >= 0.1 - 1e-9 && r.in === 9);
  markRange(p, 'out', 50); assert.equal(activeRange(p).out, 10, 'clamped to the project end');
  const q = withClip(10); markRange(q, 'out', 4);
  assert.deepEqual(activeRange(q), { in: 0, out: 4 });
  assert.equal(projectDuration(q), 10);
  q.range = { in: 3, out: 3 }; assert.equal(activeRange(q), null, 'an empty range counts as none');
});

test('audio for a marked range is cut to the same window and restarts at 0', () => {
  const p = withClip(10);
  const full = buildAudioGraph(p, 1);
  const part = buildAudioGraph(p, 1, 48000, { in: 2.5, out: 6 });
  assert.ok(!/atrim=start=2\.5000/.test(full.filter));
  assert.match(part.filter, /atrim=start=2\.5000:end=6\.0000,asetpts=PTS-STARTPTS/);
  assert.ok(part.filter.indexOf('atrim=start=2.5000') > part.filter.indexOf('amix'), 'trimmed after the mix so clips keep their timeline positions');
  const args = buildExportArgs(p, { width: 320, height: 180, fps: 30, quality: 'draft', format: 'mp4', outPath: '/o.mp4', duration: 3.5, range: { in: 2.5, out: 6 } });
  assert.ok(args.join(' ').includes('atrim=start=2.5000:end=6.0000'));
  assert.equal(args[args.indexOf('-t') + 1], '3.5000', 'the output length is the range length');
});

test('mediaBox: fits, scales, moves and rotates like the compositor', () => {
  const p = withClip();
  const clip = p.clips[0];
  const flat = mediaBox(p, clip, { scale: 1, x: 0, y: 0, rotation: 0 }, 960, 540);
  assert.deepEqual([flat.x0, flat.y0, flat.x1, flat.y1].map(Math.round), [0, 0, 960, 540]);
  const half = mediaBox(p, clip, { scale: 0.5, x: 0.25, y: 0.25, rotation: 0 }, 960, 540);       // y is "up": positive y moves the box up the screen
  assert.deepEqual([half.x0, half.y0, half.x1, half.y1].map(Math.round), [480, 0, 960, 270]);
  const rot = mediaBox(p, clip, { scale: 0.5, x: 0, y: 0, rotation: 90 }, 960, 540);
  assert.ok(Math.abs((rot.x1 - rot.x0) - 270) < 1 && Math.abs((rot.y1 - rot.y0) - 480) < 1, 'a 90° turn swaps the box');
  assert.equal(mediaBox(p, p.clips[1], { scale: 1, x: 0, y: 0, rotation: 0 }, 960, 540) !== null, true);
  p.media[0].kind = 'audio'; assert.equal(mediaBox(p, clip, { scale: 1, x: 0, y: 0, rotation: 0 }, 960, 540), null, 'audio has no picture');
});

test('alphaBox finds the ink, inBox is inclusive with padding, snapToCentre only snaps near zero', () => {
  const W = 20, H = 10, d = new Uint8ClampedArray(W * H * 4);
  for (let y = 3; y < 6; y++) for (let x = 5; x < 12; x++) d[(y * W + x) * 4 + 3] = 255;
  assert.deepEqual(alphaBox(d, W, H), { x0: 5, y0: 3, x1: 12, y1: 6 });
  assert.equal(alphaBox(new Uint8ClampedArray(W * H * 4), W, H), null);
  const b = alphaBox(d, W, H);
  assert.ok(inBox(b, 8, 4) && !inBox(b, 2, 4) && inBox(b, 3, 4, 3));
  assert.deepEqual(boxCenter(b), { x: 8.5, y: 4.5 });
  assert.equal(snapToCentre(0.005), 0); assert.equal(snapToCentre(0.05), 0.05);
});
