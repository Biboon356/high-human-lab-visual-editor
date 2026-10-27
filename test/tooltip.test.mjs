import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTip } from '../src/renderer/ui/tooltip.js';

test('parseTip: splits a trailing shortcut into label + key chips', () => {
  const t = parseTip('Undo (Ctrl/Cmd+Z)');
  assert.equal(t.label, 'Undo');
  assert.equal(t.keys.length, 2);
  assert.equal(t.keys[1], 'Z');
  assert.match(t.keys[0], /^(⌘|Ctrl)$/);
  assert.deepEqual(parseTip('Split at playhead (S)'), { label: 'Split at playhead', keys: ['S'] });
  assert.deepEqual(parseTip('Back 1 frame (←)'), { label: 'Back 1 frame', keys: ['←'] });
});

test('parseTip: prose in brackets stays in the label', () => {
  const text = 'Show TikTok / Reels safe zone (where the app UI covers the picture)';
  assert.deepEqual(parseTip(text), { label: text, keys: [] });
  assert.deepEqual(parseTip('Cut every N-th beat'), { label: 'Cut every N-th beat', keys: [] });
});
