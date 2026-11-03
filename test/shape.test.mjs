import test from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, SHAPE_KINDS, defaultShape, createShapeClip, normalizeShape, shapeBox } from '../src/shared/shape-defs.js';

test('every shape kind has a label, sane defaults and a drawable box', () => {
  assert.ok(SHAPE_KINDS.length >= 15);
  for (const k of SHAPE_KINDS) {
    const d = defaultShape(k);
    assert.equal(d.kind, k); assert.ok(SHAPES[k].label.length > 2, k);
    const b = shapeBox(d, 1920, 1080); assert.ok(b.hw > 1 && b.hh > 0.5, `${k} ${JSON.stringify(b)}`);
    if (SHAPES[k].uniform) assert.equal(b.hw, b.hh, `${k} keeps w = h in pixels`);
    assert.ok(d.n >= 1 && d.color, k);
  }
});

test('shape clips are ordinary clips: type, fields, own shape object, normalising repairs bad data', () => {
  const c = createShapeClip('flame', 1, 3, { color: '#ff0000' });
  assert.equal(c.type, 'shape'); assert.equal(c.start, 1); assert.equal(c.duration, 3); assert.equal(c.shape.color, '#ff0000');
  assert.notEqual(createShapeClip('flame').shape, c.shape);
  assert.ok(c.props && c.keyframes && Array.isArray(c.effects));
  const bad = normalizeShape({ kind: 'nonsense', w: NaN, n: 9999, glow: Infinity });
  assert.equal(bad.kind, 'rect'); assert.ok(Number.isFinite(bad.w) && bad.n <= 64 && Number.isFinite(bad.glow));
  assert.equal(normalizeShape(undefined).kind, 'rect');
});
