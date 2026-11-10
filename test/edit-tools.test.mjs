import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createClip, defaultProps } from '../src/shared/project.js';
import { freezeFrameAt, sourceSpan, sourceTimeAt, clipEnd } from '../src/shared/timeline.js';
import { CLIP_PROPS, resolveClipProps } from '../src/shared/params.js';
import { EFFECTS } from '../src/shared/effects-defs.js';
import { EFFECT_FRAG } from '../src/renderer/engine/shaders.js';

const vid = (p) => { p.media.push({ id: 'm1', kind: 'video', name: 'a.mp4', path: '/a.mp4', duration: 10, hasAudio: true }, { id: 'st', kind: 'image', name: 'still', path: '/s.png' }); };
const track = (p) => p.tracks.find((t) => t.kind === 'video');

test('sourceSpan / sourceTimeAt follow clip.in and speed', () => {
  const c = createClip({ start: 4, duration: 3, in: 2, speed: 2 });
  assert.deepEqual(sourceSpan(c), { start: 2, duration: 6 });
  assert.equal(sourceTimeAt(c, 5), 4);
  assert.equal(sourceTimeAt(createClip({ start: 0, duration: 2 }), 1.5), 1.5);
});

test('freezeFrameAt: cuts the clip, opens a gap on its track, fills it with the still, leaves other tracks alone', () => {
  const p = createProject(); vid(p);
  const tr = track(p), other = p.tracks.filter((t) => t.kind === 'video')[1];
  const a = createClip({ trackId: tr.id, mediaId: 'm1', start: 0, duration: 6, name: 'A' });
  const b = createClip({ trackId: tr.id, mediaId: 'm1', start: 6, duration: 2, name: 'B' });
  const o = createClip({ trackId: other.id, mediaId: 'm1', start: 3, duration: 1, name: 'O' });
  p.clips.push(a, b, o);
  const r = freezeFrameAt(p, a.id, 2, 1.5, 'st');
  assert.ok(r);
  assert.equal(a.duration, 2, 'left half ends at the playhead');
  assert.equal(r.freeze.start, 2); assert.equal(r.freeze.duration, 1.5); assert.equal(r.freeze.mediaId, 'st');
  assert.equal(r.right.start, 3.5, 'right half slid later by the freeze length');
  assert.equal(r.right.in, 2, 'right half continues from the frame that was frozen');
  assert.equal(b.start, 7.5, 'later clips on the track slide too');
  assert.equal(o.start, 3, 'other tracks are untouched');
  const sorted = p.clips.filter((c) => c.trackId === tr.id).sort((x, y) => x.start - y.start);
  sorted.forEach((c, i) => { if (i) assert.ok(c.start >= clipEnd(sorted[i - 1]) - 1e-9, 'no overlaps on the track'); });
});

test('freezeFrameAt refuses a playhead outside the clip or a zero length', () => {
  const p = createProject(); vid(p);
  const a = createClip({ trackId: track(p).id, mediaId: 'm1', start: 1, duration: 4 }); p.clips.push(a);
  assert.equal(freezeFrameAt(p, a.id, 0.5, 1, 'st'), null);
  assert.equal(freezeFrameAt(p, a.id, 5, 1, 'st'), null);
  assert.equal(freezeFrameAt(p, a.id, 2, 0, 'st'), null);
  assert.equal(p.clips.length, 1);
});

test('3D props: defaults are neutral, they resolve and animate like other clip props', () => {
  const d = defaultProps();
  assert.equal(d.rotX, 0); assert.equal(d.rotY, 0); assert.equal(d.flipX, 0); assert.equal(d.flipY, 0);
  for (const k of ['rotX', 'rotY', 'depth']) assert.ok(CLIP_PROPS.some((x) => x.key === k), k);
  const c = createClip({ duration: 4 });
  c.keyframes.rotY = [{ t: 0, v: 0 }, { t: 2, v: 90 }];
  assert.equal(resolveClipProps(c, 2).rotY, 90);
  assert.equal(resolveClipProps(c, 0).rotY, 0);
});

test('crop effect: every param is read by the shader', () => {
  for (const d of EFFECTS.crop.params) assert.match(EFFECT_FRAG.crop, new RegExp(`u_${d.key}\\b`), d.key);
});
