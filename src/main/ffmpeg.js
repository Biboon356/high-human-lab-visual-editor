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
  };
}

/** Transcode to a universally playable H.264/AAC proxy (used when Chromium can't decode the source). */
export async function makeProxy(src, dest) {
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', dest]);
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
  constructor({ path: file, start, duration, fps, width, height, speed = 1 }) {
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
      '-vf', `${speed !== 1 ? `setpts=PTS/${speed},` : ''}fps=${fps},scale=${width}:${height}:flags=bicubic,format=rgba`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'];
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
  const { stdout } = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-skip_frame', 'nokey', '-i', file, '-an', '-sn',
    '-vf', `fps=1/${step},scale=${tileW}:${h},tile=${n}x1`, '-frames:v', '1', '-q:v', '5', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1']);
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
