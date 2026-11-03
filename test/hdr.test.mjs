import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FFMPEG, FFPROBE, hdrKindFromTransfer, toneMapFilter, filterCaps, hdrKind, toneMapChain, probeMedia, makeProxy, ClipDecoder } from '../src/main/ffmpeg.js';

test('hdrKindFromTransfer: only HLG and PQ count as HDR', () => {
  assert.equal(hdrKindFromTransfer('arib-std-b67'), 'hlg');
  assert.equal(hdrKindFromTransfer('smpte2084'), 'pq');
  for (const t of ['bt709', 'unknown', '', undefined, null, 'iec61966-2-1']) assert.equal(hdrKindFromTransfer(t), null, String(t));
});

test('toneMapFilter: nothing for ordinary video, a real tone map with the zimg filters, an approximation without them', () => {
  assert.equal(toneMapFilter(null), '');
  const hlg = toneMapFilter('hlg'), pq = toneMapFilter('pq');
  assert.match(hlg, /tin=arib-std-b67/); assert.match(pq, /tin=smpte2084/);
  for (const f of [hlg, pq]) { assert.match(f, /tonemap=mobius/); assert.match(f, /zscale=t=bt709:m=bt709:r=tv/); assert.match(f, /format=yuv420p$/); }
  const fb = toneMapFilter('hlg', { zscale: false, tonemap: false });
  assert.doesNotMatch(fb, /zscale|tonemap/); assert.match(fb, /colorspace=all=bt709:iall=bt2020/); assert.match(fb, /format=yuv420p$/);
  assert.match(toneMapFilter('hlg', { zscale: true, tonemap: false }), /colorspace/, 'one missing filter is enough to fall back');
});

// ---- with the real ffmpeg: a small clip encoded as true HLG from an SDR picture, so the round trip can be checked ----
// (skipped where this build cannot encode HEVC or lacks the zimg filters)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-hdr-'));
const run = (bin, args) => spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
const hlgFile = path.join(dir, 'hlg.mov'), sdrFile = path.join(dir, 'sdr.mp4');
const SRC = ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=1'];
const toHlg = 'format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv,zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt2020:t=arib-std-b67:m=bt2020nc:r=tv,format=yuv420p10le';
const made = run(FFMPEG, ['-v', 'error', '-y', ...SRC, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '8', sdrFile]).status === 0
  && run(FFMPEG, ['-v', 'error', '-y', ...SRC, '-vf', toHlg, '-c:v', 'libx265', '-crf', '12', '-x265-params', 'log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:range=limited', '-tag:v', 'hvc1', hlgFile]).status === 0;
const real = { skip: made ? false : 'this ffmpeg cannot make an HLG test clip (needs libx265 and zscale)' };

const SIZE = 320 * 180 * 3;
const rgb = (args) => { const r = spawnSync(FFMPEG, ['-v', 'error', ...args, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 }); assert.equal(r.status, 0); assert.equal(r.stdout.length, SIZE); return r.stdout; };
const err = (a, b) => { let s = 0; for (let i = 0; i < SIZE; i++) s += Math.abs(a[i] - b[i]); return s / SIZE; };

test('probeMedia and hdrKind recognise an HLG clip and leave an ordinary one alone', real, async () => {
  assert.equal((await probeMedia(hlgFile)).hdr, 'hlg'); assert.equal(await hdrKind(hlgFile), 'hlg');
  assert.equal((await probeMedia(sdrFile)).hdr, null); assert.equal(await hdrKind(sdrFile), null);
  assert.equal(await toneMapChain(sdrFile), ''); assert.notEqual(await toneMapChain(hlgFile), '');
  assert.equal(typeof (await filterCaps()).zscale, 'boolean');
});

test('the tone map brings the picture back: closer to the SDR original than the flat decode, with the real filters and with the fallback', real, async () => {
  const ref = rgb(['-i', sdrFile]), flat = rgb(['-i', hlgFile]);
  const mapped = rgb(['-i', hlgFile, '-vf', toneMapFilter('hlg', await filterCaps())]);
  const fallback = rgb(['-i', hlgFile, '-vf', toneMapFilter('hlg', { zscale: false, tonemap: false })]);
  const [eFlat, eMapped, eFallback] = [err(ref, flat), err(ref, mapped), err(ref, fallback)];
  assert.ok(eMapped < eFlat * 0.6, `tone map: ${eMapped.toFixed(1)} off the original, flat decode: ${eFlat.toFixed(1)}`);
  assert.ok(eFallback < eFlat, `the fallback is better than nothing: ${eFallback.toFixed(1)} vs ${eFlat.toFixed(1)}`);
  assert.ok(eMapped < eFallback, `and the real tone map beats the fallback (${eMapped.toFixed(1)} vs ${eFallback.toFixed(1)})`);
});

test('the export decoder, the proxy and the still all give the tone-mapped picture; an ordinary clip is untouched', real, async () => {
  const ref = rgb(['-i', sdrFile]);
  const decode = async (file, toneMap) => { const d = new ClipDecoder({ path: file, start: 0, duration: 1, fps: 30, width: 320, height: 180, toneMap }); const f = await d.next(); d.close(); return f; };
  const rgbOf = (rgba) => { const o = Buffer.alloc(SIZE); for (let i = 0, j = 0; i < rgba.length; i += 4) { o[j++] = rgba[i]; o[j++] = rgba[i + 1]; o[j++] = rgba[i + 2]; } return o; };
  const flat = rgbOf(await decode(hlgFile, '')), mapped = rgbOf(await decode(hlgFile, await toneMapChain(hlgFile)));
  assert.ok(err(ref, mapped) < err(ref, flat) * 0.6, `export decoder: ${err(ref, mapped).toFixed(1)} vs ${err(ref, flat).toFixed(1)} off the original`);
  assert.deepEqual(await decode(sdrFile, await toneMapChain(sdrFile)), await decode(sdrFile, ''), 'an ordinary clip decodes exactly as before');

  const proxy = path.join(dir, 'proxy.mp4');
  await makeProxy(hlgFile, proxy);
  const info = JSON.parse(run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-select_streams', 'v:0', proxy]).stdout).streams[0];
  assert.equal(info.codec_name, 'h264'); assert.equal(info.pix_fmt, 'yuv420p');
  assert.equal(hdrKindFromTransfer(info.color_transfer), null, 'the proxy is no longer HDR');
  assert.ok(err(ref, rgb(['-i', proxy])) < err(ref, flat) * 0.6, 'and its colours are the tone-mapped ones');
  const sdrProxy = path.join(dir, 'proxy-sdr.mp4');
  await makeProxy(sdrFile, sdrProxy);
  assert.ok(err(ref, rgb(['-i', sdrProxy])) < 6, 'an ordinary clip\'s proxy is as faithful as before');
});
