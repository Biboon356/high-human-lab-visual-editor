import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { FFMPEG } from '../src/main/ffmpeg.js';
import { analyzeFile } from '../src/main/footage.js';
import { windowStats } from '../src/shared/shot-analysis.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-foot-'));
const ff = (args) => { const r = spawnSync(FFMPEG, ['-v', 'error', '-y', ...args]); assert.equal(r.status, 0, String(r.stderr)); };

test('analyzeFile: real ffmpeg decode -> series with the scene cut found, cached on the second call', async () => {
  const file = path.join(dir, 'two-scenes.mp4');
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=3', '-f', 'lavfi', '-i', 'smptebars=size=320x180:rate=30:duration=3', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0', '-pix_fmt', 'yuv420p', file]);
  const cache = path.join(dir, 'cache');
  const t0 = Date.now();
  const r = await analyzeFile({ file, kind: 'video', cacheDir: cache });
  assert.ok(r.analysis && r.analysis.n >= 22 && r.analysis.n <= 25, `~6 s at 4 fps, got ${r.analysis.n}`);
  const cuts = r.analysis.cut.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(cuts, [12], `the scene change at 3 s is sample 12, got ${cuts}`);
  assert.equal(windowStats(r.analysis, 0, 2.5).cutInside, 0);
  assert.equal(windowStats(r.analysis, 2, 4).cutInside, 1);
  const again = await analyzeFile({ file, kind: 'video', cacheDir: cache });
  assert.equal(again.cached, true);
  assert.deepEqual(again.analysis.cut, r.analysis.cut);
  console.log(`# analysed 6 s clip in ${Date.now() - t0} ms`);
});

test('analyzeFile: stills, unreadable files and cancellation', async () => {
  const img = path.join(dir, 'p.png');
  ff(['-f', 'lavfi', '-i', 'mandelbrot=size=320x180:rate=1', '-frames:v', '1', img]);
  const s = await analyzeFile({ file: img, kind: 'image' });
  assert.ok(s.still && s.still.sharp > 0 && s.still.motion === 0);
  const bad = path.join(dir, 'bad.mp4'); fs.writeFileSync(bad, 'nope');
  await assert.rejects(analyzeFile({ file: bad, kind: 'video' }), /could not decode/);
  const file = path.join(dir, 'long.mp4');
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=60', '-pix_fmt', 'yuv420p', file]);
  const signal = { aborted: true };
  await assert.rejects(analyzeFile({ file, kind: 'video', signal }), /cancelled/);
});
