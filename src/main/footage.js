// Footage analysis for the smart montage: ffmpeg decodes small frames, shared/shot-analysis.js measures them.
// Results are cached (memory + disk) per file, so re-rolling a montage or editing the music costs nothing.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FFMPEG, toneMapChain } from './ffmpeg.js';
import { analyzeFrames, stillStats, frameFeatures } from '../shared/shot-analysis.js';

const FW = 64, FH = 36, FPS = 4, MAX_SECONDS = 1200, VERSION = 2; // 2: HDR clips are analysed after tone-mapping (version 1 read them flat)
const live = new Set();
export const killFootage = () => { for (const p of live) { try { p.kill('SIGKILL'); } catch { /* gone */ } } live.clear(); };

async function decodeFrames(file, { image = false, signal } = {}) {
  const chain = image ? '' : await toneMapChain(file); // colours are read after the HDR tone map, as the picture really looks
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-i', file, '-an', '-sn'];
    if (image) args.push('-frames:v', '1'); else args.push('-t', String(MAX_SECONDS));
    args.push('-vf', `${image ? '' : `fps=${FPS},`}scale=${FW}:${FH}:flags=area${chain ? `,${chain}` : ''}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1');
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    live.add(p);
    const size = FW * FH * 3, frames = [];
    let pending = Buffer.alloc(0);
    const err = [];
    p.stdout.on('data', (d) => {
      pending = pending.length ? Buffer.concat([pending, d]) : d;
      while (pending.length >= size) { frames.push(new Uint8Array(pending.subarray(0, size))); pending = pending.subarray(size); }
    });
    p.stderr.on('data', (d) => err.push(d));
    const poll = signal ? setInterval(() => { if (signal.aborted) p.kill('SIGKILL'); }, 200) : null;
    p.on('error', (e) => { clearInterval(poll); live.delete(p); reject(new Error(e.message)); });
    p.on('close', (code) => {
      clearInterval(poll); live.delete(p);
      if (signal?.aborted) return reject(new Error('Analysis cancelled.'));
      if (!frames.length) return reject(new Error(`ffmpeg could not decode "${path.basename(file)}": ${Buffer.concat(err).toString().trim().split('\n').slice(-2).join(' | ') || `exit ${code}`}`));
      resolve(frames);
    });
  });
}

/** Rounds series so the JSON that crosses IPC (and sits in the cache) stays small. */
const pack = (S) => {
  const r = (a, d = 3) => a.map((v) => Math.round(v * 10 ** d) / 10 ** d);
  return { fps: S.fps, n: S.n, w: S.w, h: S.h, mean: r(S.mean), contrast: r(S.contrast), sharp: r(S.sharp, 4), sat: r(S.sat), hue: r(S.hue, 0), motion: r(S.motion, 4), cx: r(S.cx, 2), cy: r(S.cy, 2), dx: S.dx, dy: S.dy, cut: S.cut };
};

export async function analyzeFile({ file, kind, cacheDir, signal }) {
  const st = fs.statSync(file);
  const key = crypto.createHash('sha1').update(`${VERSION}|${kind}|${path.resolve(file)}|${st.size}|${st.mtimeMs}`).digest('hex');
  const cacheFile = cacheDir ? path.join(cacheDir, `${key}.json`) : null;
  if (cacheFile && fs.existsSync(cacheFile)) { try { return { ...JSON.parse(fs.readFileSync(cacheFile, 'utf8')), cached: true }; } catch { /* corrupt cache entry: recompute */ } }
  let result;
  if (kind === 'image') {
    const [f] = await decodeFrames(file, { image: true, signal });
    result = { still: stillStats(f, FW, FH) };
  } else {
    const frames = await decodeFrames(file, { signal });
    result = { analysis: pack(analyzeFrames(frames, FW, FH, FPS)) };
  }
  if (cacheFile) { try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(result)); } catch { /* read-only profile: fine */ } }
  return result;
}

export { frameFeatures };
