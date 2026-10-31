import test from 'node:test';
import assert from 'node:assert/strict';
import { planMemoryFrame, pickEchoes, MemoryAdapt, MEMORY_SCALES, MEMORY_MAX_GAP } from '../src/shared/living/memory-plan.js';
import { EFFECTS } from '../src/shared/effects-defs.js';
import { EFFECT_FRAG } from '../src/renderer/engine/shaders.js';
import { EFFECT_META, checkMeta, supportsWet } from '../src/shared/mutation/effect-meta.js';

const now = { mode: 0, hw: 480, hh: 270 };
const st = (over = {}) => ({ lastT: 1, ...now, ...over });

test('planMemoryFrame: consecutive frames advance, the same frame redraws, a seek resets — exactly what an export from there would do', () => {
  assert.deepEqual(planMemoryFrame(null, 0, now), { action: 'reset' });
  assert.deepEqual(planMemoryFrame(st({ lastT: null }), 0, now), { action: 'reset' });
  const a = planMemoryFrame(st(), 1 + 1 / 30, now);
  assert.equal(a.action, 'advance'); assert.ok(Math.abs(a.step - 1 / 30) < 1e-9);
  assert.deepEqual(planMemoryFrame(st(), 1, now), { action: 'redraw' });
  assert.deepEqual(planMemoryFrame(st(), 1 + 1e-5, now), { action: 'redraw' }, 'sub-tick differences are the same frame');
  assert.equal(planMemoryFrame(st(), 0.5, now).action, 'reset', 'backwards');
  assert.equal(planMemoryFrame(st(), 1 + MEMORY_MAX_GAP + 0.01, now).action, 'reset', 'a long jump forwards');
  assert.equal(planMemoryFrame(st(), 1 + MEMORY_MAX_GAP - 0.01, now).action, 'advance', 'a slow frame is still playback');
  for (const change of [{ mode: 2 }, { hw: 240 }, { hh: 100 }]) assert.equal(planMemoryFrame(st(change), 1.03, now).action, 'reset', JSON.stringify(change));
});

test('simulated playback: the memory only ever depends on the frames since the last reset (so preview and export agree)', () => {
  // a stand-in for the GPU state: remember how many frames have been folded in
  const run = (times) => {
    let s = null; let frames = 0, last = [];
    for (const t of times) {
      const plan = planMemoryFrame(s, t, now);
      if (plan.action === 'reset') { s = { lastT: t, ...now }; frames = 1; }
      else if (plan.action === 'advance') { s.lastT = t; frames++; }
      last.push(frames);
    }
    return last;
  };
  const f = (n, t0 = 0) => Array.from({ length: n }, (_, i) => t0 + i / 30);
  assert.deepEqual(run(f(5)), [1, 2, 3, 4, 5], 'export: every frame adds');
  assert.deepEqual(run([...f(5), 4 / 30, 4 / 30, 4 / 30]), [1, 2, 3, 4, 5, 5, 5, 5], 'a paused preview repainting the last frame does not add to the memory');
  const playback = run([...f(10), 8, ...f(4, 8 + 1 / 30)]);
  assert.equal(playback[10], 1, 'a seek to 8 s starts afresh');
  assert.deepEqual(playback.slice(10), [1, 2, 3, 4, 5], 'and then grows from there, like an export starting at 8 s');
  assert.deepEqual(run(f(30, 8)).slice(0, 5), run([...f(3), ...f(5, 8)]).slice(3), 'same result after any detour');
});

test('pickEchoes: newest first, strictly older than now, not expired, at most four', () => {
  const ring = [{ t: 0.0, slot: 0 }, { t: 0.5, slot: 1 }, { t: 1.0, slot: 2 }, { t: 1.5, slot: 3 }, { t: 2.0, slot: 4 }];
  assert.deepEqual(pickEchoes(ring, 2.0, 3).map((e) => e.slot), [3, 2, 1, 0], 'the snapshot of this very frame is not shown');
  assert.deepEqual(pickEchoes(ring, 2.0, 0.5).map((e) => e.slot), [3], 'expired ones drop out (age > length * 1.6 = 0.8 s)');
  assert.equal(pickEchoes(ring, 2.2, 3, 2).length, 2);
  assert.deepEqual(pickEchoes([], 1, 1), []);
  // redrawing the same frame after it took its snapshot gives the same answer as before
  const before = pickEchoes(ring.slice(0, 4), 2.0, 3), after = pickEchoes(ring, 2.0, 3);
  assert.deepEqual(after, before);
});

test('MemoryAdapt lowers the quality when playback stutters and raises it again when it is calm; idle when no memory effect is shown', () => {
  const a = new MemoryAdapt();
  assert.equal(a.scale, MEMORY_SCALES[0]);
  for (let i = 0; i < 200; i++) a.update(16, true);
  assert.equal(a.scale, MEMORY_SCALES[0], 'smooth playback keeps full memory quality');
  for (let i = 0; i < 400; i++) a.update(120, false);
  assert.equal(a.scale, MEMORY_SCALES[0], 'no memory effect on screen: nothing changes');
  let scales = new Set();
  for (let i = 0; i < 300; i++) scales.add(a.update(90, true));
  assert.ok(scales.has(MEMORY_SCALES[1]) && a.scale === MEMORY_SCALES[2], `stutter steps down to the floor (${[...scales]})`);
  for (let i = 0; i < 20; i++) assert.equal(a.update(90, true), MEMORY_SCALES[2], 'never below the floor');
  for (let i = 0; i < 800; i++) a.update(14, true);
  assert.equal(a.scale, MEMORY_SCALES[0], 'calm again: back up');
  assert.ok(MEMORY_SCALES.every((s, i) => i === 0 || s < MEMORY_SCALES[i - 1]));
});

test('the memory effect is registered, has a shader and meta, and exposes the controls the brief asks for', () => {
  const m = EFFECTS.memory;
  assert.ok(m && EFFECT_FRAG.memory);
  assert.deepEqual(m.params.find((p) => p.key === 'mode').options, ['Ghost', 'Stain', 'Scar', 'Echo']);
  for (const k of ['length', 'decay', 'intensity', 'blend']) assert.ok(m.params.some((p) => p.key === k), k);
  assert.deepEqual(checkMeta(), []);
  assert.equal(EFFECT_META.memory.addable, false, 'a roll does not insert it: a still thumbnail cannot show a memory');
  assert.equal(supportsWet('memory'), true);
  assert.match(EFFECT_FRAG.memory, /u_pass/);
});
