// ffmpeg / ffprobe wrapper. Prefers bundled static binaries, falls back to PATH.
import { spawn } from 'node:child_process';
import { appRequire } from './app-root.js';
import fs from 'node:fs';
import path from 'node:path';

const require = appRequire; // dependencies come from the installed app even when this file runs from an update

function unpacked(p) {
  // Inside a packaged app, binaries are unpacked from the asar archive.
  return p && p.includes('app.asar') ? p.replace('app.asar', 'app.asar.unpacked') : p;
}

function resolveBinary(envVar, pkg, getPath, fallback) {
  if (process.env[envVar] && fs.existsSync(process.env[envVar])) return process.env[envVar];
  try {
    const p = unpacked(getPath(require(pkg)));
    if (p && fs.existsSync(p)) return p;
  } catch { /* package not installed */ }
  return fallback;
}

export const FFMPEG = resolveBinary('HHLAB_FFMPEG', 'ffmpeg-static', (m) => m, 'ffmpeg');
export const FFPROBE = resolveBinary('HHLAB_FFPROBE', 'ffprobe-static', (m) => m.path, 'ffprobe');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg', '.opus', '.aif', '.aiff']);

export function run(bin, args, { collect = true } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [], err = [];
    p.stdout.on('data', (d) => collect && out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', (e) =>
      reject(new Error(e.code === 'ENOENT' ? `Could not find "${bin}". Reinstall dependencies (npm install) or set HHLAB_FFMPEG / HHLAB_FFPROBE.` : e.message)));
    p.on('close', (code) => {
      const stderr = Buffer.concat(err).toString();
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr });
      else reject(new Error(`${path.basename(bin)} exited with code ${code}: ${stderr.trim().split('\n').slice(-4).join(' | ')}`));
    });
  });
}

// ---- HDR phone footage (HLG / PQ) ----
// An iPhone clip shot in HDR is stored as 10-bit BT.2020 with an HLG curve. Decoded as if it were ordinary video it looks washed out,
// so every place that turns such a clip into pictures (proxy, export, thumbnails, stills, reverse, footage analysis) tone-maps it to
// normal SDR first, with ffmpeg's own filters.

/** 'hlg' | 'pq' | null from an ffprobe `color_transfer` value. */
export function hdrKindFromTransfer(t) {
  if (t === 'arib-std-b67') return 'hlg';
  if (t === 'smpte2084') return 'pq';
  return null;
}

/**
 * The filter chain that turns HDR frames into SDR yuv420p, or '' for ordinary video. With the zimg filters it is a proper tone map
 * (linear light, Mobius curve, back to BT.709). A build without them gets an approximation: the right primaries and matrix, then a
 * little contrast and saturation (it will not match a real tone map, but it is far closer than leaving the clip flat).
 */
export function toneMapFilter(kind, { zscale = true, tonemap = true } = {}) {
  if (!kind) return '';
  if (zscale && tonemap) {
    const tin = kind === 'pq' ? 'smpte2084' : 'arib-std-b67';
    return `zscale=tin=${tin}:min=bt2020nc:pin=bt2020:rin=tv:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=mobius:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p`;
  }
  return 'colorspace=all=bt709:iall=bt2020:fast=1,eq=contrast=1.12:saturation=1.15,format=yuv420p';
}

let capsPromise = null;
/** Which of the filters above this ffmpeg build has (asked once). */
export function filterCaps() {
  capsPromise ||= run(FFMPEG, ['-hide_banner', '-filters']).then(({ stdout }) => { const s = stdout.toString(); return { zscale: /\bzscale\b/.test(s), tonemap: /\btonemap\b/.test(s) }; }).catch(() => ({ zscale: false, tonemap: false }));
  return capsPromise;
}

const hdrCache = new Map();
/** 'hlg' | 'pq' | null for a video file (remembered per file and modification time). */
export async function hdrKind(file) {
  let key = file;
  try { key = `${file}|${fs.statSync(file).mtimeMs}`; } catch { /* unreadable: ffprobe will say */ }
  if (!hdrCache.has(key)) {
    hdrCache.set(key, run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_transfer', '-of', 'csv=p=0', file])
      .then(({ stdout }) => hdrKindFromTransfer(stdout.toString().trim().split(/[\s,]+/)[0])).catch(() => null));
  }
  return hdrCache.get(key);
}

/** The tone-map chain for this file ('' when it is not HDR). */
export async function toneMapChain(file) {
  const kind = await hdrKind(file);
  return kind ? toneMapFilter(kind, await filterCaps()) : '';
}

/** Tags for output that has been tone-mapped, so players treat it as the ordinary BT.709 it now is. */
export const SDR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];

export async function probeMedia(file) {
  const ext = path.extname(file).toLowerCase();
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const info = JSON.parse(stdout.toString());
  const streams = info.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = streams.find((s) => s.codec_type === 'audio');
  let kind;
  if (IMAGE_EXT.has(ext) && v) kind = 'image';
  else if (AUDIO_EXT.has(ext) || (!v && a)) kind = 'audio';
  else if (v) kind = 'video';
  else throw new Error(`"${path.basename(file)}" has no readable video, audio or image stream.`);
  // Phone footage is often stored sideways with a rotation flag that players (and ffmpeg) apply automatically.
  const rot = Math.abs(Number(v?.side_data_list?.find((d) => 'rotation' in d)?.rotation ?? v?.tags?.rotate ?? 0)) % 180;
  const [vw, vh] = rot === 90 ? [v?.height || 0, v?.width || 0] : [v?.width || 0, v?.height || 0];
  const duration = Number(info.format?.duration) || Number(v?.duration) || Number(a?.duration) || 0;
  let fps = 0;
  if (v?.avg_frame_rate && v.avg_frame_rate !== '0/0') {
    const [n, d] = v.avg_frame_rate.split('/').map(Number);
    fps = d ? n / d : n;
  }
  return {
    path: file,
    name: path.basename(file),
    kind,
    duration: kind === 'image' ? 0 : duration,
    width: vw,
    height: vh,
    fps: Math.round(fps * 100) / 100,
    hasAudio: kind !== 'image' && !!a,
    codec: (v || a)?.codec_name || '',
    hdr: kind === 'video' ? hdrKindFromTransfer(v?.color_transfer) : null, // 'hlg' | 'pq' | null: such clips are tone-mapped wherever they are decoded
  };
}

/** Transcode to a universally playable H.264/AAC proxy (used when Chromium can't decode the source). */
export async function makeProxy(src, dest) {
  const chain = await toneMapChain(src); // HDR phone footage becomes ordinary SDR here, so the preview shows it the way the phone did
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, ...(chain ? ['-vf', chain, ...SDR_TAGS] : []), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', dest]);
  return dest;
}

/**
 * Reverses [start, start+duration) of a clip into a new playable file. ffmpeg's `reverse` filter holds every frame it is
 * given in memory, so the picture is reversed in short chunks (stitched back in reverse order) and the sound, which is
 * small, in one piece. Memory stays bounded however long the clip is.
 */
export async function reverseRange(src, dest, { start = 0, duration, hasAudio = true, hasVideo = true, fps = 30, width = 1920, height = 1080 }, tmpDir) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  fs.mkdirSync(tmpDir, { recursive: true });
  const base = ['-hide_banner', '-loglevel', 'error', '-y'];
  const parts = [];
  try {
    let videoFile = null;
    const chain = hasVideo ? await toneMapChain(src) : '';
    if (hasVideo) {
      const chunk = width * height > 2200000 ? 1 : 2; // 4K gets 1 s chunks
      const n = Math.max(1, Math.ceil(duration / chunk));
      for (let i = n - 1; i >= 0; i--) {
        const s0 = start + i * chunk, len = Math.min(chunk, duration - i * chunk);
        const f = path.join(tmpDir, `c${n - 1 - i}.mp4`);
        await run(FFMPEG, [...base, '-ss', String(s0), '-t', String(len), '-i', src, '-an', '-vf', `fps=${fps},${chain ? `${chain},` : ''}reverse`,
          ...(chain ? SDR_TAGS : []), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', f]);
        parts.push(f);
      }
      videoFile = path.join(tmpDir, 'video.mp4');
      const list = path.join(tmpDir, 'list.txt');
      fs.writeFileSync(list, parts.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
      await run(FFMPEG, [...base, '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', videoFile]);
    }
    let audioFile = null;
    if (hasAudio) {
      audioFile = path.join(tmpDir, 'audio.m4a');
      await run(FFMPEG, [...base, '-ss', String(start), '-t', String(duration), '-i', src, '-vn', '-af', 'areverse', '-c:a', 'aac', '-b:a', '192k', audioFile]);
    }
    const inputs = [videoFile, audioFile].filter(Boolean).flatMap((f) => ['-i', f]);
    await run(FFMPEG, [...base, ...inputs, '-c', 'copy', '-movflags', '+faststart', dest]);
    return dest;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** One frame of a video at `time`, as a PNG at full source resolution. */
export async function extractFrame(src, dest, time) {
  const chain = await toneMapChain(src);
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, time)), '-i', src, ...(chain ? ['-vf', chain] : []), '-frames:v', '1', '-an', dest]);
  return dest;
}

/** Decode an ffmpeg audio graph to f32le PCM, returned as a Float32Array. */
export async function decodePcm(args) {
  const { stdout } = await run(FFMPEG, args);
  const ab = stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength - (stdout.byteLength % 4));
  return new Float32Array(ab);
}

/** Streams raw frames to ffmpeg. Resolves/rejects with real encoder status. */
export class ExportSession {
  constructor(args, outPath, totalFrames, onProgress) {
    this.outPath = outPath;
    this.tail = [];
    this.written = 0;
    this.failed = null;
    this.proc = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    this.exited = new Promise((resolve) => {
      this.proc.on('close', (code, sig) => resolve({ code, sig }));
      this.proc.on('error', (e) => {
        this.failed = new Error(e.code === 'ENOENT' ? `ffmpeg not found ("${FFMPEG}"). Run npm install or set HHLAB_FFMPEG.` : e.message);
        resolve({ code: -1 });
      });
    });
    this.proc.stdin.on('error', (e) => { this.failed ||= new Error(`Encoder pipe closed: ${e.code || e.message}`); });
    let buf = '';
    this.proc.stderr.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        this.tail.push(l);
        if (this.tail.length > 30) this.tail.shift();
        const m = /^frame=(\d+)/.exec(l);
        if (m && onProgress) onProgress(Number(m[1]) / totalFrames);
      }
    });
  }

  errorText() {
    return this.tail.filter((l) => !l.includes('=')).slice(-6).join(' | ') || this.tail.slice(-3).join(' | ');
  }

  async writeFrame(buffer) {
    if (this.failed) throw this.failed;
    if (this.proc.exitCode !== null) throw new Error(`Encoder stopped early: ${this.errorText()}`);
    if (!this.proc.stdin.write(buffer)) {
      // Wait for the pipe to drain — or for the encoder to die, in which case 'drain' never comes.
      const died = await Promise.race([new Promise((res) => this.proc.stdin.once('drain', () => res(false))), this.exited.then(() => true)]);
      if (died) throw this.failed || new Error(`Encoder stopped: ${this.errorText() || 'cancelled'}`);
    }
    this.written++;
  }

  async finish() {
    this.proc.stdin.end();
    const { code } = await this.exited;
    if (this.failed) throw this.failed;
    if (code !== 0) throw new Error(`ffmpeg failed (exit ${code}): ${this.errorText()}`);
    return this.outPath;
  }

  cancel() {
    try { this.proc.kill('SIGKILL'); } catch { /* already gone */ }
    return this.exited.then(() => fs.promises.rm(this.outPath, { force: true }));
  }
}

/**
 * Sequential RGBA frame reader for one video clip: ffmpeg seeks once, then emits frames at the project fps.
 * Replaces per-frame <video> seeking during export (faster, VFR-safe, always reads the original file, never a proxy).
 */
export class ClipDecoder {
  constructor({ path: file, start, duration, fps, width, height, speed = 1, toneMap = '' }) {
    this.frameBytes = width * height * 4;
    this.queue = [];
    this.waiters = [];
    this.chunks = [];
    this.have = 0;
    this.ended = false;
    this.last = null;
    this.err = [];
    this.error = null;
    const args = ['-hide_banner', '-loglevel', 'error', '-ss', String(start), '-t', String(duration), '-i', file, '-an', '-sn',
      '-vf', `${speed !== 1 ? `setpts=PTS/${speed},` : ''}fps=${fps},scale=${width}:${height}:flags=bicubic,${toneMap ? `${toneMap},` : ''}format=rgba`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'];
    this.proc = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc.on('error', (e) => { this.error = new Error(e.code === 'ENOENT' ? `ffmpeg not found ("${FFMPEG}")` : e.message); this._finish(); });
    this.proc.stderr.on('data', (d) => this.err.push(d));
    this.proc.stdout.on('data', (d) => this._data(d));
    this.proc.on('close', (code) => {
      if (code !== 0 && !this.killed) this.error = new Error(`Decoding "${path.basename(file)}" failed: ${Buffer.concat(this.err).toString().trim().split('\n').slice(-3).join(' | ') || `exit ${code}`}`);
      this._finish();
    });
  }

  _data(d) {
    this.chunks.push(d); this.have += d.length;
    while (this.have >= this.frameBytes) {
      const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks);
      const frame = Buffer.from(all.subarray(0, this.frameBytes));
      const rest = all.subarray(this.frameBytes);
      this.chunks = rest.length ? [rest] : []; this.have = rest.length;
      this._push(frame);
    }
    if (this.queue.length >= 6) this.proc.stdout.pause(); // back-pressure: don't decode far ahead of the renderer
  }
  _push(frame) { const w = this.waiters.shift(); if (w) w.resolve(frame); else this.queue.push(frame); }
  _finish() {
    this.ended = true;
    for (const w of this.waiters.splice(0)) this.error ? w.reject(this.error) : w.resolve(null);
  }

  /** Next frame in order, or the last frame again once the stream ends (rounding at clip tails). */
  async next() {
    let f;
    if (this.queue.length) { f = this.queue.shift(); if (this.queue.length < 3) this.proc.stdout.resume(); }
    else if (this.ended) { if (this.error && !this.last) throw this.error; f = null; }
    else f = await new Promise((resolve, reject) => { this.waiters.push({ resolve, reject }); this.proc.stdout.resume(); });
    if (f) this.last = f;
    else if (!this.last) throw this.error || new Error('Decoder produced no frames.');
    return this.last;
  }

  close() { this.killed = true; try { this.proc.kill('SIGKILL'); } catch { /* already gone */ } }
}

/** One JPEG sprite (n tiles side by side) of evenly spaced video frames for timeline thumbnails. Keyframes only: fast on long files. */
export async function makeThumbs(file, { duration, width, height, h = 56 }) {
  const step = Math.max(1, duration / 48);
  const n = Math.max(1, Math.ceil(duration / step));
  const tileW = Math.max(8, Math.round(((h * width) / Math.max(1, height)) / 2) * 2);
  const chain = await toneMapChain(file);
  const { stdout } = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-skip_frame', 'nokey', '-i', file, '-an', '-sn',
    '-vf', `fps=1/${step},scale=${tileW}:${h},${chain ? `${chain},` : ''}tile=${n}x1`, '-frames:v', '1', '-q:v', '5', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1']);
  return { jpeg: stdout, step, n, tileW, h };
}

/** Peak envelope (0..255) of the audio, `perSec` bins per second. */
export async function makePeaks(file, perSec = 50) {
  const rate = 8000;
  const { stdout } = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', 'pipe:1']);
  const samples = new Int16Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength - (stdout.byteLength % 2)));
  const bin = Math.round(rate / perSec);
  const out = new Uint8Array(Math.max(1, Math.floor(samples.length / bin)));
  for (let i = 0; i < out.length; i++) {
    let m = 0;
    for (let j = i * bin, e = j + bin; j < e; j++) { const v = Math.abs(samples[j]); if (v > m) m = v; }
    out[i] = Math.min(255, Math.round((m / 32768) * 255 * 1.6)); // gentle boost so quiet material is still visible
  }
  return { peaks: out, perSec };
}

/** Decodes [start, start+duration) of a media file's audio to 16 kHz mono signed-16 PCM (what Whisper expects). */
/** Gentle speech clean-up for the recogniser only (rumble/hiss off, steady level): TikTok audio is often noisy and uneven. */
export const ASR_CLEANUP = 'highpass=f=80,lowpass=f=7800,afftdn=nr=10:nf=-40,dynaudnorm=f=200:g=11:p=0.92';

export async function extractPcm16k(file, start = 0, duration = 0, { clean = false } = {}) {
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (start > 0) args.push('-ss', String(start));
  if (duration > 0) args.push('-t', String(duration));
  args.push('-i', file, '-vn', '-sn');
  if (clean) args.push('-af', ASR_CLEANUP);
  args.push('-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1');
  const { stdout } = await run(FFMPEG, args);
  if (stdout.length < 3200) throw new Error('This clip has no audio to transcribe.');
  const ab = stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength - (stdout.byteLength % 2));
  return new Int16Array(ab);
}
