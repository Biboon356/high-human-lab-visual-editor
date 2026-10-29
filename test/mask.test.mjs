import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createShape, createMask, normalizeMask, maskTransform, applyTransform, inverseTransform, pointInShape, pointInMask, moveShape, nearestEdge,
  maskBounds, maskKey, canBeMatte, matteSourceIds, normalizeMatte, MASK_PROPS, MAX_POINTS,
} from '../src/shared/mask.js';
import { createProject, createClip, validateProject } from '../src/shared/project.js';
import { resolveClipProps } from '../src/shared/params.js';

const close = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} ≉ ${b}`);

test('shapes: rect, ellipse and polygon contain the right points', () => {
  const r = createShape('rect', { cx: 0.5, cy: 0.5, w: 0.2, h: 0.4 });
  assert.ok(pointInShape(r, [0.55, 0.65]) && !pointInShape(r, [0.65, 0.5]));
  const e = createShape('ellipse', { w: 0.4, h: 0.2 });
  assert.ok(pointInShape(e, [0.5, 0.5]) && pointInShape(e, [0.69, 0.5]) && !pointInShape(e, [0.69, 0.58]));
  const p = createShape('poly', { pts: [[0.2, 0.8], [0.5, 0.2], [0.8, 0.8]] });
  assert.ok(pointInShape(p, [0.5, 0.6]) && !pointInShape(p, [0.2, 0.3]));
  assert.throws(() => createShape('star'), /Unknown/);
});

test('mask: cut-out shapes subtract, invert flips, normalising drops junk', () => {
  const m = { shapes: [createShape('rect', { w: 0.8, h: 0.8 }), createShape('ellipse', { w: 0.2, h: 0.2, sub: true })], invert: false };
  assert.equal(pointInMask(m, [0.2, 0.5]), true);
  assert.equal(pointInMask(m, [0.5, 0.5]), false, 'the cut-out leaves a hole');
  assert.equal(pointInMask({ ...m, invert: true }, [0.5, 0.5]), true);
  assert.equal(normalizeMask(null), null);
  assert.equal(normalizeMask({ shapes: [{ k: 'poly', pts: [[0, 0], [1, 1]] }, { k: 'nope' }] }), null, 'a two-point polygon and unknown kinds are dropped');
  const n = normalizeMask({ shapes: [{ k: 'rect', cx: 0.5, cy: 0.5, w: -1, h: 0.2, r: 9 }, createShape('poly', { pts: Array.from({ length: 200 }, (_, i) => [i / 200, (i % 7) / 7]) })] });
  assert.ok(n.shapes[0].w > 0 && n.shapes[0].r <= 0.5);
  assert.equal(n.shapes[1].pts.length, MAX_POINTS);
});

test('mask transform: move, turn and scale round-trip on a non-square frame', () => {
  const m = createMask('rect', { cx: 0.4, cy: 0.6, w: 0.2, h: 0.2 });
  const xf = maskTransform(m, { maskX: 0.1, maskY: -0.05, maskScale: 1.5, maskRot: 30 });
  for (const p of [[0.4, 0.6], [0.3, 0.5], [0.9, 0.1]]) {
    const q = applyTransform(xf, p, 1920, 1080), back = inverseTransform(xf, q, 1920, 1080);
    close(back[0], p[0]); close(back[1], p[1]);
  }
  const id = maskTransform(m, { maskX: 0, maskY: 0, maskScale: 1, maskRot: 0 });
  const same = applyTransform(id, [0.3, 0.7], 1280, 720); close(same[0], 0.3); close(same[1], 0.7);
  const up = applyTransform(maskTransform(m, { maskX: 0, maskY: 0.2, maskScale: 1, maskRot: 0 }), [0.4, 0.6], 100, 100);
  close(up[1], 0.4, 1e-9); // positive Y moves the mask up the frame, like a clip's Y
  const b = maskBounds(m); close(b.u0, 0.3); close(b.v1, 0.7);
});

test('moving a shape and inserting a polygon point', () => {
  const p = createShape('poly', { pts: [[0.2, 0.8], [0.5, 0.2], [0.8, 0.8]] });
  assert.deepEqual(moveShape(p, 0.1, -0.1).pts[0], [0.30000000000000004, 0.7000000000000001]);
  const hit = nearestEdge(p, [0.5, 0.79], 0.03);
  assert.equal(hit.index, 3, 'a click on the bottom edge inserts after the last corner');
  assert.equal(nearestEdge(p, [0.5, 0.5], 0.03), null);
});

test('mask props are keyframable clip props with defaults; old projects get them on load', () => {
  const c = createClip({ trackId: 't' });
  for (const d of MASK_PROPS) assert.equal(c.props[d.key], d.def, d.key);
  c.keyframes.maskX = [{ t: 0, v: 0 }, { t: 2, v: 0.5 }];
  close(resolveClipProps(c, 1, null).maskX, 0.25);
  const p = createProject(); const old = createClip({ trackId: p.tracks[0].id }); delete old.props.maskGrow; delete old.props.maskFeather; p.clips.push(old);
  validateProject(p); assert.equal(old.props.maskFeather, 0.15);
});

test('mask cache key changes with anything visible and not with anything else', () => {
  const m = createMask('ellipse'), pr = { maskX: 0, maskY: 0, maskScale: 1, maskRot: 0, maskFeather: 0.1, maskGrow: 0 };
  const k = maskKey(m, pr, 320, 180);
  assert.equal(maskKey(m, { ...pr }, 320, 180), k);
  assert.notEqual(maskKey(m, { ...pr, maskX: 0.01 }, 320, 180), k);
  assert.notEqual(maskKey({ ...m, invert: true }, pr, 320, 180), k);
  assert.notEqual(maskKey(m, pr, 640, 360), k);
});

test('mattes: any other picture clip can be a matte; no self, no adjustment layer, no two-way loops; sources are hidden', () => {
  const p = createProject(); const v = p.tracks.find((t) => t.kind === 'video').id, a = p.tracks.find((t) => t.kind === 'audio').id;
  const mk = (type, trackId = v) => { const c = createClip({ type, trackId }); p.clips.push(c); return c; };
  const text = mk('text'), media = mk('media'), adj = mk('adjust'), snd = mk('media', a);
  assert.ok(canBeMatte(p, media, text.id));
  assert.ok(!canBeMatte(p, media, media.id) && !canBeMatte(p, media, adj.id) && !canBeMatte(p, media, snd.id) && !canBeMatte(p, media, 'missing'));
  media.matte = { source: text.id, use: 'alpha' };
  assert.ok(!canBeMatte(p, text, media.id), 'a clip cannot be matted by the clip it mattes');
  assert.deepEqual([...matteSourceIds(p)], [text.id]);
  media.matte = { source: 'gone' }; assert.equal(matteSourceIds(p).size, 0);
  assert.deepEqual(normalizeMatte({ source: 'x', use: 'bogus', invert: 1 }), { source: 'x', use: 'alpha', invert: true });
  assert.equal(normalizeMatte({}), null);
});
