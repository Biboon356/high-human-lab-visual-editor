import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSpeech, subtractRanges, buildTimeMap, remapWords, planReframe, punchLevels, loudWords } from '../src/shared/autoedit.js';

// 100 frames/s envelope: speech 0.5-2.0, pause 2.0-3.2, speech 3.2-5.0, short pause 5.0-5.2, speech 5.2-6.0, breath blip at 7.0
function envelope() {
  const rate = 100, rms = new Float32Array(900).fill(0.01);
  const on = (a, b, v = 0.6) => { for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) rms[i] = v + 0.1 * Math.sin(i); };
  on(0.5, 2.0); on(3.2, 5.0); on(5.2, 6.0); on(7.0, 7.05, 0.5);
  return { rate, rms };
}

test('detectSpeech finds the speech bursts, bridges short pauses, ignores blips, pads the edges', () => {
  const s = detectSpeech(envelope(), { minSilence: 0.35, minSpeech: 0.12, pad: 0.08 });
  assert.equal(s.length, 2, JSON.stringify(s));
  assert.ok(Math.abs(s[0].start - 0.42) < 0.06 && Math.abs(s[0].end - 2.08) < 0.06, 'first burst padded by ~80ms');
  assert.ok(Math.abs(s[1].start - 3.12) < 0.06 && Math.abs(s[1].end - 6.08) < 0.06, 'the 0.2s pause is bridged, second burst runs 3.2-6.0');
  assert.deepEqual(detectSpeech({ rate: 100, rms: new Float32Array(500).fill(0.02) }), [], 'flat noise has no speech');
  assert.deepEqual(detectSpeech({ rate: 100, rms: [] }), []);
  const tight = detectSpeech(envelope(), { minSilence: 0.1 });
  assert.equal(tight.length, 3, 'a shorter minSilence also cuts the 0.2s pause');
});

test('subtractRanges removes cuts (filler words) from kept speech', () => {
  const keep = [{ start: 0, end: 5 }, { start: 8, end: 10 }];
  assert.deepEqual(subtractRanges(keep, [{ start: 1, end: 2 }]), [{ start: 0, end: 1 }, { start: 2, end: 5 }, { start: 8, end: 10 }]);
  assert.deepEqual(subtractRanges(keep, [{ start: -1, end: 11 }]), []);
  assert.deepEqual(subtractRanges(keep, [{ start: 4.98, end: 8.02 }]), [{ start: 0, end: 4.98 }, { start: 8.02, end: 10 }]);
  assert.deepEqual(subtractRanges(keep, [{ start: 0, end: 4.99 }], 0.05), [{ start: 8, end: 10 }], 'slivers shorter than minLen vanish');
});

test('time map lays kept ranges back-to-back and maps words through the edit', () => {
  const tm = buildTimeMap([{ start: 1, end: 3 }, { start: 6, end: 9 }]);
  assert.equal(tm.duration, 5);
  assert.equal(tm.map(1), 0); assert.equal(tm.map(2.5), 1.5); assert.equal(tm.map(6), 2); assert.equal(tm.map(8), 4); assert.equal(tm.map(4), null);
  assert.equal(tm.mapNearest(4), 2, 'a cut moment snaps to the closest boundary');
  const w = remapWords([{ text: 'a', start: 1.2, end: 1.6 }, { text: 'cut', start: 3.5, end: 4 }, { text: 'half', start: 2.8, end: 3.4 }, { text: 'b', start: 6.5, end: 7 }], tm);
  assert.deepEqual(w.map((x) => x.text), ['a', 'half', 'b']);
  assert.ok(Math.abs(w[1].start - 1.8) < 1e-9 && Math.abs(w[1].end - 2) < 1e-9, 'a word cut in half is clipped at the boundary');
  assert.ok(Math.abs(w[2].start - 2.5) < 1e-9);
});

test('reframe 16:9 -> 9:16: fill crops (scale up), fit keeps, blurfit keeps + backdrop', () => {
  const fill = planReframe({ srcW: 1920, srcH: 1080, dstW: 1080, dstH: 1920, mode: 'fill' });
  assert.ok(Math.abs(fill.scale - (1920 / 1080) / (1080 / 1920)) < 1e-9, `~3.16, got ${fill.scale}`);
  assert.equal(planReframe({ srcW: 1080, srcH: 1920, dstW: 1080, dstH: 1920 }).scale, 1, 'portrait source already fills');
  const bf = planReframe({ srcW: 1920, srcH: 1080, dstW: 1080, dstH: 1920, mode: 'blurfit' });
  assert.equal(bf.scale, 1); assert.equal(bf.background, true); assert.ok(bf.backgroundScale > 3);
  assert.equal(planReframe({ srcW: 1920, srcH: 1080, dstW: 1080, dstH: 1920, mode: 'fit' }).background, false);
});

test('punch levels alternate; loudWords picks the loudest words only', () => {
  assert.deepEqual(punchLevels(4), [1, 1.12, 1, 1.12]);
  const env = { rate: 100, rms: new Float32Array(300).fill(0.2) };
  for (let i = 100; i < 140; i++) env.rms[i] = 0.9;
  const words = [{ text: 'เบา', start: 0, end: 0.5 }, { text: 'ดัง', start: 1.0, end: 1.4 }, { text: 'เบา', start: 2.0, end: 2.5 }, { text: 'ก', start: 1.0, end: 1.4 }];
  const l = loudWords(words, env, { fraction: 0.3, minChars: 2 });
  assert.deepEqual(l.map((w) => w.start), [1.0], 'only the loud multi-character word');
  assert.deepEqual(loudWords(words, { rate: 100, rms: [] }), []);
});
