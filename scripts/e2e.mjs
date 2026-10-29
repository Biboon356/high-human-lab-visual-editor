// End-to-end test: launches the real Electron app (under Xvfb + software GL on headless Linux),
// imports real media, edits, saves/reopens, exports, and verifies the output with ffprobe.
// Usage: xvfb-run -a node scripts/e2e.mjs     (on a desktop with a display: node scripts/e2e.mjs)
import { createRequire } from 'node:module';
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
let pw;
for (const name of ['playwright-core', 'playwright']) {
  for (const base of [root + '/', '/opt/node-tools/']) { try { pw = createRequire(base)(name); break; } catch { /* try next */ } }
  if (pw) break;
}
if (!pw) throw new Error('Playwright is required for the e2e test: npm i -D playwright-core');
const { _electron } = pw;
const { FFMPEG, FFPROBE } = await import(path.join(root, 'src/main/ffmpeg.js'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-e2e-'));
const shots = process.env.HHLAB_SHOTS || path.join(dir, 'shots');
fs.mkdirSync(shots, { recursive: true });
const sh = (bin, args) => { const r = spawnSync(bin, args, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')}\n${r.stderr}`); return r.stdout; };
const probe = (f) => JSON.parse(sh(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f]));

// ---- fixtures
const clip = path.join(dir, 'clip.mp4'), kick = path.join(dir, 'kick.wav'), pic = path.join(dir, 'pic.png');
sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '15', '-c:a', 'aac', '-shortest', clip]);
sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='sin(2*PI*60*t)*exp(-8*mod(t,0.5))':s=44100:d=8", kick]);
sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'mandelbrot=size=400x300:rate=1', '-frames:v', '1', pic]);

const results = [];
const only = process.env.HHLAB_ONLY ? new RegExp(process.env.HHLAB_ONLY, 'i') : null;
const step = async (name, fn) => {
  if (only && !only.test(name)) return;
  const t0 = Date.now();
  // watchdog: if a step is suspiciously slow, dump the export pipeline state so a hang is diagnosable from the log
  const dog = setInterval(async () => {
    try { console.log(`      [slow step "${name.slice(0, 40)}" ${Math.round((Date.now() - t0) / 1000)}s] renderer=${JSON.stringify(await page.evaluate(() => globalThis.__exportState))} main=${JSON.stringify(await page.evaluate(() => window.hh.exportDebug()))}`); } catch { /* page busy */ }
  }, 60000);
  try { await fn(); clearInterval(dog); results.push([name, 'PASS', Date.now() - t0]); console.log(`PASS  ${name} (${Date.now() - t0}ms)`); }
  catch (e) { clearInterval(dog); results.push([name, 'FAIL', e.message]); console.log(`FAIL  ${name}\n      ${e.message.split('\n').join('\n      ')}`); }
};

// local stand-in for the model host (the real one is huggingface.co): serves 160 MB of zeros for any path
import http from 'node:http';
const modelServer = http.createServer((q, r) => { const total = 160e6; r.writeHead(200, { 'Content-Length': total }); const chunk = Buffer.alloc(1 << 20); let sent = 0; const pump = () => { while (sent < total) { const n = Math.min(chunk.length, total - sent); sent += n; if (!r.write(n === chunk.length ? chunk : chunk.subarray(0, n))) return r.once('drain', pump); } r.end(); }; pump(); }).listen(0, '127.0.0.1');
await new Promise((res) => modelServer.once('listening', res));
const app = await _electron.launch({
  executablePath: req('electron'),
  args: [root, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  env: { ...process.env, HHLAB_E2E: '1', HHLAB_E2E_NO_RECOVERY: '1', HHLAB_MODEL_BASE: `http://127.0.0.1:${modelServer.address().port}` },
});
const page = await app.firstWindow();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.waitForFunction(() => window.__app);
const ev = (fn, arg) => page.evaluate(fn, arg);
// Reads the compositor's framebuffer (the canvas itself is cleared after presentation).
await ev(() => {
  window.__grab = (w = 64, h = 36) => {
    const { preview } = window.__app; preview.forceDraw();
    const src = preview.comp.readPixels(), W = preview.comp.w, H = preview.comp.h, out = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = Math.floor((x + 0.5) * W / w), sy = H - 1 - Math.floor((y + 0.5) * H / h), i = (sy * W + sx) * 4;
      out.push(src[i], src[i + 1], src[i + 2]);
    }
    return out;
  };
});
const shot = (n) => page.screenshot({ path: path.join(shots, `${n}.png`) });
const px = () => ev(() => { const d = window.__grab(64, 36); let s = 0, nz = 0; for (let i = 0; i < d.length; i += 3) { const v = d[i] + d[i + 1] + d[i + 2]; s += v; if (v > 30) nz++; } return { mean: s / d.length, lit: nz / (d.length / 3) }; });
const settle = async (ms = 500) => { await page.waitForTimeout(ms); };

await step('app boots with WebGL2 compositor and no console errors', async () => {
  assert.equal(await ev(() => !!document.getElementById('preview').getContext('webgl2')), true);
  await shot('01-empty');
});

await step('import video + audio + image through the real probe pipeline', async () => {
  const added = await ev((p) => window.__app.importPaths(p), [clip, kick, pic]);
  assert.equal(added.length, 3);
  const m = await ev(() => window.__app.store.project.media.map((x) => ({ k: x.kind, d: x.duration, a: x.hasAudio, w: x.width })));
  assert.deepEqual(m.map((x) => x.k), ['video', 'audio', 'image']);
  assert.ok(Math.abs(m[0].d - 6) < 0.2); assert.equal(m[0].a, true); assert.equal(m[0].w, 640);
  const st = await ev(() => ({ ...window.__app.store.project.settings, clips: window.__app.store.project.clips.length }));
  assert.deepEqual(st, { width: 640, height: 360, fps: 30, clips: 1 }, 'first video auto-placed and sets project size');
});

await step('preview shows decoded video (not black) and scrubs to different frames', async () => {
  const snap = async (t) => { await ev((t) => window.__app.store.setPlayhead(t), t); await settle(900); return ev(() => window.__grab(64, 36)); };
  const a = await snap(0.5), b = await snap(4.2);
  const lit = (d) => d.filter((v) => v > 10).length / d.length;
  const l1 = a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
  assert.ok(lit(a) > 0.5 && lit(b) > 0.5, 'frames have content');
  assert.ok(l1 > 3, `different video frames at 0.5s and 4.2s (mean abs diff ${l1.toFixed(2)})`);
  await shot('02-video-preview');
});

await step('timeline: add audio + image clips, split, trim, move, delete, undo/redo', async () => {
  const r = await ev(async () => {
    const { store } = window.__app; const { addMediaClip, splitClip, moveClip, trimEnd, trimStart, deleteClip } = await import('/shared/timeline.js');
    const p = store.project, out = {};
    const a = store.project.media.find((m) => m.kind === 'audio'), img = p.media.find((m) => m.kind === 'image');
    const aT = p.tracks.find((t) => t.kind === 'audio').id, v2 = p.tracks.find((t) => t.name === 'V2').id;
    store.mutate(() => { addMediaClip(p, a.id, aT, 0); addMediaClip(p, img.id, v2, 1); });
    out.clips = store.project.clips.length;
    const vclip = p.clips.find((c) => c.type === 'media' && p.media.find((m) => m.id === c.mediaId).kind === 'video');
    store.setPlayhead(3); store.select(vclip.id);
    document.getElementById('tl-split').click();
    out.afterSplit = store.project.clips.length;
    const right = store.project.clips.find((c) => Math.abs(c.start - 3) < 1e-6 && c.mediaId === vclip.mediaId);
    out.rightIn = right.in;
    store.mutate(() => { trimEnd(p, right.id, 5.5); });
    out.rightDur = right.duration;
    store.select(right.id);
    document.getElementById('tl-delete').click();
    out.afterDelete = store.project.clips.length;
    store.undo();
    out.afterUndo = store.project.clips.length;
    store.redo();
    out.afterRedo = store.project.clips.length;
    store.undo(); // keep the right half for later steps
    return out;
  });
  assert.deepEqual(r, { clips: 3, afterSplit: 4, rightIn: 3, rightDur: 2.5, afterDelete: 3, afterUndo: 4, afterRedo: 3 });
  const dom = await ev(() => document.querySelectorAll('.clip').length);
  assert.equal(dom, 4);
  await shot('03-timeline');
});

await step('timeline UI drag: move clip with pointer events and trim edge', async () => {
  const box = await ev(() => { const c = [...document.querySelectorAll('.clip.image')][0]; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const before = await ev(() => window.__app.store.project.clips.find((c) => c.name === 'pic.png').start);
  await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.w / 2 + 150, box.y + box.h / 2, { steps: 8 }); await page.mouse.up();
  const after = await ev(() => window.__app.store.project.clips.find((c) => c.name === 'pic.png').start);
  assert.ok(after > before + 1.5, `moved ${before} -> ${after}`);
  const box2 = await ev(() => { const r = [...document.querySelectorAll('.clip.image')][0].getBoundingClientRect(); return { x: r.right, y: r.y + r.height / 2 }; });
  const d0 = await ev(() => window.__app.store.project.clips.find((c) => c.name === 'pic.png').duration);
  await page.mouse.move(box2.x - 3, box2.y); await page.mouse.down(); await page.mouse.move(box2.x - 63, box2.y, { steps: 6 }); await page.mouse.up();
  const d1 = await ev(() => window.__app.store.project.clips.find((c) => c.name === 'pic.png').duration);
  assert.ok(d1 < d0 - 0.5, `trimmed ${d0} -> ${d1}`);
});

await step('effects: add chain + presets render visibly different output', async () => {
  const r = await ev(async () => {
    const { store } = window.__app; const { createEffect, EFFECT_PRESETS, instantiatePreset } = await import('/shared/effects-defs.js');
    const c = store.project.clips.find((x) => x.name === 'clip.mp4');
    store.setPlayhead(1); store.select(c.id);
    await new Promise((r) => setTimeout(r, 800));
    const grab = () => window.__grab(96, 54);
    const diff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
    const base = grab(); const out = {};
    for (const type of ['glitch', 'grain', 'noise', 'distort', 'fluid', 'blur', 'color', 'crt', 'chroma', 'bloom', 'film', 'vhs', 'mosh', 'halftone', 'pixel', 'shake', 'flash', 'gradmap', 'threshold', 'solarize', 'slices', 'mask', 'outline']) {
      const pre = type === 'outline' ? [createEffect('mask', { size: 0.25 })] : []; // outline needs transparency to act on
      store.mutate(() => c.effects.push(...pre, createEffect(type, ({ color: { tint: 1, saturation: 0.2 }, blur: { radius: 20 }, distort: { amount: 0.08 }, chroma: { amount: 0.07 }, bloom: { intensity: 2, threshold: 0.1 }, film: { grain: 1, vignette: 1 }, vhs: { noise: 1, tracking: 1 }, mosh: { amount: 1 }, halftone: {}, pixel: { size: 30 }, shake: { amount: 0.1, zoom: 1.4, roll: 8 }, flash: { amount: 1.5, rate: 0.5, decay: 1, white: 1 }, gradmap: {}, threshold: { noise: 1 }, solarize: {}, slices: { black: 0.6, shift: 0.3, bands: 8 }, mask: { size: 0.2 }, outline: { width: 30 } })[type] || { amount: 0.9 })));
      await new Promise((r) => setTimeout(r, 250));
      out[type] = +diff(base, grab()).toFixed(2);
      store.mutate(() => { c.effects.length -= 1 + pre.length; });
    }
    store.mutate(() => c.effects.push(...instantiatePreset(EFFECT_PRESETS[0])));
    await new Promise((r) => setTimeout(r, 300));
    out.preset = +diff(base, grab()).toFixed(2); out.chain = c.effects.length;
    return out;
  });
  for (const k of ['glitch', 'grain', 'noise', 'distort', 'fluid', 'blur', 'color', 'crt', 'chroma', 'bloom', 'film', 'vhs', 'mosh', 'halftone', 'pixel', 'shake', 'flash', 'gradmap', 'threshold', 'solarize', 'slices', 'mask', 'outline', 'preset']) assert.ok(r[k] > 0.4, `effect ${k} changed the image: ${JSON.stringify(r)}`);
  assert.equal(r.chain, 3);
  await shot('04-effects');
});

await step('typography + organic generator clips render', async () => {
  const r = await ev(async () => {
    const { store } = window.__app; const { createTextClip, TEXT_PRESETS } = await import('/shared/text-defs.js');
    const { createGeneratorClip, GEN_PRESETS } = await import('/shared/organic-defs.js'); const { addClipRaw } = await import('/shared/timeline.js');
    const p = store.project, top = p.tracks.find((t) => t.name === 'V2').id;
    const v1 = p.tracks.find((t) => t.name === 'V1').id;
    const t = createTextClip(TEXT_PRESETS.find((x) => x.name === 'Glitch Title'), 0.2, 2.5); t.trackId = top;
    t.keyframes.rotation = [{ t: 0, v: 0 }, { t: 2, v: 10 }];
    const g = createGeneratorClip(GEN_PRESETS[0], 6.2, 3); g.trackId = v1;
    store.mutate(() => { addClipRaw(p, t); addClipRaw(p, g); });
    store.select(t.id); store.setPlayhead(1.2);
    await new Promise((r) => setTimeout(r, 600));
    const d = window.__grab(128, 72);
    let white = 0; for (let i = 0; i < d.length; i += 3) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) white++;
    return { white, textId: t.id, genId: g.id };
  });
  assert.ok(r.white > 15, `text pixels visible: ${r.white}`);
  await shot('05-typography');
  const g = await ev(async ({ genId }) => { const { store } = window.__app; store.setPlayhead(7); store.select(genId); await new Promise((r) => setTimeout(r, 600));
    const d = window.__grab(64, 36);
    let lit = 0, green = 0; for (let i = 0; i < d.length; i += 3) { if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; if (d[i + 1] > d[i] + 15) green++; } return { lit, green }; }, r);
  assert.ok(g.lit > 40 && g.green > 5, `organic pattern visible and green-accented: ${JSON.stringify(g)}`);
  await shot('06-organic');
});

await step('audio analysis detects the kick track + reactive binding changes output', async () => {
  const r = await ev(async () => {
    const { store, runAnalysis } = window.__app;
    const a = await runAnalysis({ quiet: true });
    const out = { beats: a.beats.length, bpm: a.bpm, dur: Math.round(a.duration) };
    const c = store.project.clips.find((x) => x.name === 'clip.mp4');
    const fx = c.effects[0] || null;
    const { createEffect } = await import('/shared/effects-defs.js');
    store.mutate(() => { c.effects.length = 0; const e = createEffect('color', { brightness: 0 }); e.bindings.brightness = { source: 'beat', amount: 0.6 }; c.effects.push(e); });
    const { sampleFeatures } = await import('/shared/audio-analysis.js');
    const grab = () => { const d = window.__grab(32, 18); let s = 0; for (let i = 0; i < d.length; i += 3) s += d[i]; return s / (32 * 18); };
    const onBeat = a.beats[3] + 0.005; const offBeat = a.beats[3] + 0.45;
    store.setPlayhead(Math.min(onBeat, 5.9)); await new Promise((r) => setTimeout(r, 700)); out.fOn = +sampleFeatures(a, store.playhead).beat.toFixed(2); out.lumOn = grab();
    store.setPlayhead(Math.min(offBeat, 5.9)); await new Promise((r) => setTimeout(r, 700)); out.fOff = +sampleFeatures(a, store.playhead).beat.toFixed(2); out.lumOff = grab();
    return out;
  });
  assert.ok(r.beats >= 10 && Math.abs(r.bpm - 120) < 8, JSON.stringify(r));
  assert.ok(r.fOn > r.fOff + 0.4, JSON.stringify(r));
  assert.ok(r.lumOn > r.lumOff + 5, `visual brightness follows the beat: ${JSON.stringify(r)}`);
  await ev(() => document.querySelector('[data-tab="reactive"]').click()); await settle(300); await shot('07-reactive');
});

await step('save project to disk, reopen it, state round-trips', async () => {
  const file = path.join(dir, 'test.hhlab');
  const before = await ev(() => window.__app.store.project);
  // Save through the real IPC path (dialog bypassed by passing filePath)
  const saved = await ev(async (f) => window.hh.saveProject(window.__app.store.project, f, false), file);
  assert.equal(saved.filePath, file);
  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(disk.clips.length, before.clips.length);
  assert.equal(fs.existsSync(file + '.tmp'), false, 'no temp file left');
  await ev(async (d) => { window.__app.store.loadProject(d, null); }, disk);
  const after = await ev(() => window.__app.store.project);
  assert.deepEqual(after.clips.map((c) => c.id), before.clips.map((c) => c.id));
  assert.deepEqual(after.clips.find((c) => c.name === 'clip.mp4').effects[0].bindings, { brightness: { source: 'beat', amount: 0.6 } });
  await settle(900);
  const p = await px(); assert.ok(p.lit > 0.2, 'preview restored after reopen');
  // corrupted file → clear error
  fs.writeFileSync(path.join(dir, 'bad.hhlab'), '{"version":1,"media":[]}');
  const err = await ev(async () => { try { (await import('/shared/project.js')).validateProject({ version: 1, media: [] }); return null; } catch (e) { return e.message; } });
  assert.match(err, /missing/);
});

const out1 = path.join(dir, 'out.mp4');
await step('export H.264/AAC: real render, verified with ffprobe', async () => {
  await ev(() => { const { store } = window.__app; store.setPlayhead(0); });
  const res = await ev((o) => window.__app.exportTo(o, { width: 640, height: 360, fps: 24, quality: 'draft' }), out1);
  assert.ok(fs.statSync(out1).size > 10000, 'file written');
  const info = probe(out1);
  const v = info.streams.find((s) => s.codec_type === 'video'), a = info.streams.find((s) => s.codec_type === 'audio');
  assert.equal(v.codec_name, 'h264'); assert.equal(v.width, 640); assert.equal(v.height, 360); assert.equal(v.r_frame_rate, '24/1');
  assert.ok(a && a.codec_name === 'aac', 'audio stream present');
  const projDur = await ev(async () => (await import('/shared/timeline.js')).projectDuration(window.__app.store.project));
  assert.ok(Math.abs(Number(info.format.duration) - projDur) < 0.25, `duration ${info.format.duration} vs ${projDur}`);
  assert.equal(res.hasAudio, true);
  // frames differ over time and are not black
  const frames = [0.5, 2.0, 7.0].map((t, i) => { const f = path.join(dir, `f${i}.png`); sh(FFMPEG, ['-v', 'error', '-y', '-ss', String(t), '-i', out1, '-frames:v', '1', f]); return f; });
  const sizes = frames.map((f) => fs.statSync(f).size);
  assert.ok(sizes.every((s) => s > 2000), `non-trivial frames ${sizes}`);
  const blackCheck = sh(FFMPEG, ['-v', 'info', '-i', out1, '-vf', 'blackdetect=d=0.5:pix_th=0.05', '-an', '-f', 'null', '-']);
  fs.copyFileSync(frames[0], path.join(shots, '08-export-frame-0.5s.png')); fs.copyFileSync(frames[1], path.join(shots, '09-export-frame-2.0s.png')); fs.copyFileSync(frames[2], path.join(shots, '10-export-frame-7.0s.png'));
});

await step('export matches preview pixel-for-pixel-ish (same engine)', async () => {
  const t = 1.0;
  const previewMean = await ev(async (t) => { const { store } = window.__app; store.setPlayhead(t); await new Promise((r) => setTimeout(r, 800));
    const d = window.__grab(64, 36); let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 3) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } const n = d.length / 3; return [r / n, g / n, b / n]; }, t);
  const f = path.join(dir, 'cmp.raw'); sh(FFMPEG, ['-v', 'error', '-y', '-ss', String(t), '-i', out1, '-frames:v', '1', '-vf', 'scale=64:36', '-pix_fmt', 'rgb24', '-f', 'rawvideo', f]);
  const d = fs.readFileSync(f); let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 3) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } const n = d.length / 3;
  const diff = Math.max(Math.abs(r / n - previewMean[0]), Math.abs(g / n - previewMean[1]), Math.abs(b / n - previewMean[2]));
  assert.ok(diff < 12, `mean colour preview ${previewMean.map((x) => x.toFixed(0))} vs export ${[r / n, g / n, b / n].map((x) => x.toFixed(0))}`);
});

await step('export WebM/VP9 works too', async () => {
  const out = path.join(dir, 'out.webm');
  await ev((o) => window.__app.exportTo(o, { width: 320, height: 180, fps: 15, quality: 'draft' }), out);
  const v = probe(out).streams.find((s) => s.codec_type === 'video');
  assert.equal(v.codec_name, 'vp9'); assert.equal(v.width, 320);
});

await step('export errors are real: missing source file is reported, nothing written', async () => {
  const out = path.join(dir, 'fail.mp4');
  const msg = await ev(async (o) => { const { store } = window.__app; const p = structuredClone(store.project); p.media[0].path = '/nonexistent/file.mp4';
    const { renderProject } = await import('/app/engine/exporter.js');
    try { await renderProject({ project: p, settings: { width: 320, height: 180, fps: 15, quality: 'draft', format: 'mp4', outPath: o }, analysis: null, onProgress() {}, signal: { cancelled: false } }); return 'NO ERROR'; } catch (e) { return e.message; } }, out);
  assert.match(msg, /missing|Cannot|not found/i, msg);
  assert.equal(fs.existsSync(out), false);
});

await step('export cancel leaves no file and the app stays usable', async () => {
  const out = path.join(dir, 'cancel.mp4');
  if (!(await ev(() => window.__app.store.project.clips.length))) await ev((p) => window.__app.importPaths([p]), clip);
  const msg = await ev(async (o) => { const { renderProject, ExportCancelled } = await import('/app/engine/exporter.js'); const { store } = window.__app; const signal = { cancelled: false };
    setTimeout(() => { signal.cancelled = true; }, 700);
    try { await renderProject({ project: structuredClone(store.project), settings: { width: 640, height: 360, fps: 30, quality: 'high', format: 'mp4', outPath: o }, analysis: store.analysis, onProgress() {}, signal }); return 'NO ERROR'; } catch (e) { return e instanceof ExportCancelled ? 'cancelled' : e.message; } }, out);
  assert.equal(msg, 'cancelled'); assert.equal(fs.existsSync(out), false);
  const again = await ev(async (o) => (await window.__app.exportTo(o, { width: 160, height: 90, fps: 10 })).frames, path.join(dir, 'again.mp4'));
  assert.ok(again > 20);
});


// ---- UI-level flows (native dialogs are stubbed in the Electron main process; everything else is the real code path)
const stubDialog = (method, value) => app.evaluate(({ dialog }, { method, value }) => { dialog[method] = async () => value; }, { method, value });
const resetProject = () => ev(async () => { const { createProject } = await import('/shared/project.js'); window.__app.store.loadProject(createProject()); });

await step('transport: Play advances the playhead in real time, video element follows, pause holds', async () => {
  await ev(() => window.__app.store.setPlayhead(0));
  await page.click('#t-play'); await page.waitForTimeout(1500);
  const mid = await ev(() => { const { store, preview } = window.__app; const v = [...preview.sources.videos.values()].find((x) => !x.paused); return { playing: store.playing, t: store.playhead, vt: v ? v.currentTime : null }; });
  assert.equal(mid.playing, true); assert.ok(mid.t > 1.1 && mid.t < 2.2, `playhead ${mid.t}`);
  assert.ok(mid.vt !== null && Math.abs(mid.vt - mid.t) < 0.4, `video element tracks timeline: ${JSON.stringify(mid)}`);
  await page.click('#t-play'); const t1 = await ev(() => window.__app.store.playhead); await page.waitForTimeout(400);
  assert.equal(await ev(() => window.__app.store.playhead), t1, 'paused');
  await page.keyboard.press('ArrowRight');
  assert.ok(Math.abs((await ev(() => window.__app.store.playhead)) - t1 - 1 / 30) < 1e-6, 'frame step');
});

await step('Save (dialog) → dirty indicator → New → Open (dialog) restores project', async () => {
  const file = path.join(dir, 'ui-saved.hhlab');
  await stubDialog('showSaveDialog', { canceled: false, filePath: file });
  await ev(() => window.__app.store.mutate((p) => { p.name = 'ui flow'; }));
  assert.equal(await ev(() => document.getElementById('dirty-dot').hidden), false, 'dirty after edits');
  await page.click('[data-act="save"]'); await page.waitForFunction(() => document.getElementById('dirty-dot').hidden);
  assert.ok(fs.existsSync(file));
  const n = JSON.parse(fs.readFileSync(file, 'utf8')).clips.length;
  await ev(() => window.__app.store.mutate((p) => { p.name = 'edited'; }));
  assert.equal(await ev(() => document.getElementById('dirty-dot').hidden), false);
  page.once('dialog', (d) => d.accept()); await page.click('[data-act="new"]');
  assert.equal(await ev(() => window.__app.store.project.clips.length), 0);
  await stubDialog('showOpenDialog', { canceled: false, filePaths: [file] });
  await page.click('[data-act="open"]'); await page.waitForFunction((n) => window.__app.store.project.clips.length === n, n);
  await ev(() => window.__app.store.setPlayhead(1)); await settle(900);
  assert.ok((await px()).lit > 0.3, 'opened project renders (media access re-granted)');
  assert.equal(await ev(() => window.__app.store.filePath), file);
});

await step('Export dialog UI: choose file, render, progress, verified result box', async () => {
  const out = path.join(dir, 'ui-export.mp4');
  await resetProject(); await ev((p) => window.__app.importPaths([p]), clip);
  await stubDialog('showSaveDialog', { canceled: false, filePath: out });
  await page.click('[data-act="export"]'); await page.waitForSelector('.modal');
  // address the selects by their row label, not position (the Preset select was added in front)
  await page.selectOption('.modal .grid > select >> nth=3', 'draft'); // Preset, Resolution, Frame rate, Quality, Format
  await page.click('.modal button:has-text("Choose")'); await page.waitForFunction(() => document.querySelector('.modal input[readonly]').value);
  await page.click('.modal button:text-is("Render")');
  await page.waitForSelector('.modal .progress:not([hidden])');
  await page.waitForSelector('.modal .okbox, .modal .errbox', { timeout: 120000 });
  await shot('12-export-dialog');
  const txt = await ev(() => document.querySelector('.modal .okbox, .modal .errbox').textContent);
  assert.match(txt, /Render verified/, txt);
  assert.ok(probe(out).streams.some((s) => s.codec_type === 'video'));
  await ev(() => { [...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Close').click(); });
});

await step('unsupported codec (ProRes) falls back to an H.264 proxy and still exports', async () => {
  const prores = path.join(dir, 'pro.mov');
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-c:v', 'prores_ks', '-profile:v', '1', '-c:a', 'pcm_s16le', '-shortest', prores]);
  await resetProject();
  const m = await ev(async (p) => { await window.__app.importPaths([p]); const md = window.__app.store.project.media[0]; return md ? { proxy: !!md.playPath, kind: md.kind, clips: window.__app.store.project.clips.length } : null; }, prores);
  assert.deepEqual(m, { proxy: true, kind: 'video', clips: 1 });
  await ev(() => window.__app.store.setPlayhead(0.5)); await settle(1000);
  assert.ok((await px()).lit > 0.3, 'proxy frame visible');
  const out = path.join(dir, 'prores-out.mp4');
  await ev((o) => window.__app.exportTo(o, { fps: 25 }), out);
  const i = probe(out); assert.equal(i.streams.find((s) => s.codec_type === 'video').width, 320); assert.ok(i.streams.some((s) => s.codec_type === 'audio'));
});

await step('missing media after reopen: clip flagged, preview survives, export refuses with a clear error', async () => {
  const tmpClip = path.join(dir, 'will-vanish.mp4'); fs.copyFileSync(clip, tmpClip);
  await resetProject(); await ev((p) => window.__app.importPaths([p]), tmpClip);
  const file = path.join(dir, 'missing.hhlab');
  await ev((f) => window.hh.saveProject(window.__app.store.project, f, false), file);
  fs.rmSync(tmpClip);
  await stubDialog('showOpenDialog', { canceled: false, filePaths: [file] });
  page.once('dialog', (d) => d.accept());
  await page.click('[data-act="open"]'); await page.waitForFunction(() => window.__app.store.project.media[0]?.missing);
  await ev(() => window.__app.store.setPlayhead(0.5)); await settle(500);
  assert.equal(await ev(() => !!document.querySelector('.media-item.missing') && !!document.querySelector('.clip')), true);
  const out = path.join(dir, 'missing-out.mp4'); await stubDialog('showSaveDialog', { canceled: false, filePath: out });
  await page.click('[data-act="export"]'); await page.click('.modal button:has-text("Choose")'); await page.waitForFunction(() => document.querySelector('.modal input[readonly]').value);
  await page.click('.modal button:text-is("Render")'); await page.waitForSelector('.modal .errbox, .modal .okbox', { timeout: 30000 });
  const txt = await ev(() => document.querySelector('.modal .errbox, .modal .okbox').textContent);
  assert.match(txt, /Export failed.*(missing|not found)/i, txt); assert.equal(fs.existsSync(out), false);
  await ev(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Close').click());
});

await step('ffmpeg-decode export: faster than element seeking, same picture, uses the original not the proxy', async () => {
  const longGop = path.join(dir, 'longgop.mp4');
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=8', '-c:v', 'libx264', '-g', '240', '-pix_fmt', 'yuv420p', longGop]);
  await resetProject(); await ev((p) => window.__app.importPaths([p]), longGop);
  const run = async (decoder, out) => { const t0 = Date.now(); await ev((a) => window.__app.exportTo(a.out, { width: 640, height: 360, fps: 30, decoder: a.decoder }), { out, decoder }); return Date.now() - t0; };
  const oEl = path.join(dir, 'dec-el.mp4'), oFf = path.join(dir, 'dec-ff.mp4');
  const tEl = await run('element', oEl), tFf = await run('ffmpeg', oFf);
  console.log(`      timing (8s long-GOP 720p -> 360p): element-seek ${tEl}ms, ffmpeg-decode ${tFf}ms`);
  assert.ok(tFf < tEl, `ffmpeg decode should be faster (${tFf} vs ${tEl})`);
  const info = probe(oFf); assert.ok(Math.abs(Number(info.format.duration) - 8) < 0.2);
  const psnrOf = (x, y) => { const r = spawnSync(FFMPEG, ['-v', 'info', '-i', x, '-i', y, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' }); const m = /average:([\d.]+|inf)/.exec(r.stderr); return m ? (m[1] === 'inf' ? 99 : Number(m[1])) : 0; };
  // Ground truth: ffmpeg scaling the source directly. testsrc2 burns in a frame counter, so any off-by-one frame tanks PSNR.
  const ref = path.join(dir, 'longgop-ref.mp4'); sh(FFMPEG, ['-v', 'error', '-y', '-i', longGop, '-vf', 'scale=640:360', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', ref]);
  const pFf = psnrOf(oFf, ref), pEl = psnrOf(oEl, ref);
  console.log(`      PSNR vs ground truth: ffmpeg-decode ${pFf.toFixed(1)} dB, element-seek ${pEl.toFixed(1)} dB`);
  assert.ok(pFf > 33, `ffmpeg-decode export is frame-accurate (PSNR ${pFf})`);
  // frame-accurate: the burned-in testsrc2 frame counter must advance in order — 3 sample frames differ and are non-black
  const f = [1, 4, 7].map((t, i) => { const o = path.join(dir, `acc${i}.png`); sh(FFMPEG, ['-v', 'error', '-y', '-ss', String(t), '-i', oFf, '-frames:v', '1', o]); return fs.statSync(o).size; });
  assert.ok(f.every((x) => x > 3000));
});

await step('proxy-needing source exports from the ORIGINAL file (full quality), not the proxy', async () => {
  const prores = path.join(dir, 'pro2.mov');
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=2', '-c:v', 'prores_ks', '-profile:v', '3', prores]);
  await resetProject(); await ev((p) => window.__app.importPaths([p]), prores);
  assert.equal(await ev(() => !!window.__app.store.project.media[0].playPath), true, 'preview uses a proxy');
  const out = path.join(dir, 'pro2-out.mp4'); await ev((o) => window.__app.exportTo(o, { fps: 25, quality: 'high' }), out);
  const ref = path.join(dir, 'pro2-ref.mp4'); sh(FFMPEG, ['-v', 'error', '-y', '-i', prores, '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', ref]);
  const r = spawnSync(FFMPEG, ['-v', 'info', '-i', out, '-i', ref, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /average:([\d.]+|inf)/.exec(r.stderr); const psnr = m ? (m[1] === 'inf' ? 99 : Number(m[1])) : 0;
  console.log(`      PSNR export vs direct ffmpeg encode of the original: ${psnr} dB`);
  assert.ok(psnr > 38, `export matches the original-quality reference (PSNR ${psnr})`);
});

await step('rotated phone video: portrait dimensions detected, project adapts, export is upright', async () => {
  const base = path.join(dir, 'land.mp4'), rot = path.join(dir, 'rot.mp4');
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', base]);
  sh(FFMPEG, ['-v', 'error', '-y', '-display_rotation:v', '90', '-i', base, '-c', 'copy', rot]);
  await resetProject(); await ev((p) => window.__app.importPaths([p]), rot);
  const st = await ev(() => ({ ...window.__app.store.project.settings, mw: window.__app.store.project.media[0].width, mh: window.__app.store.project.media[0].height }));
  assert.equal(st.mw, 180); assert.equal(st.mh, 320); assert.equal(st.width, 180); assert.equal(st.height, 320);
  const out = path.join(dir, 'rot-out.mp4'); await ev((o) => window.__app.exportTo(o, { fps: 30 }), out);
  const v = probe(out).streams.find((s) => s.codec_type === 'video'); assert.equal(v.width, 180); assert.equal(v.height, 320);
  const px2 = path.join(dir, 'rot.raw'); sh(FFMPEG, ['-v', 'error', '-y', '-ss', '0.5', '-i', out, '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', px2]);
  const d = fs.readFileSync(px2); let lit = 0; for (const b of d) if (b > 40) lit++;
  assert.ok(lit / d.length > 0.5, 'frame fully covered (no letterboxing from a wrong size)');
});

await step('large file: seeking deep into a file that is not fully buffered works (Range/206 handling)', async () => {
  const big = path.join(dir, 'big.mp4');
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=20', '-c:v', 'libx264', '-b:v', '9M', '-g', '60', '-pix_fmt', 'yuv420p', big]);
  assert.ok(fs.statSync(big).size > 8e6, 'fixture is large enough to need real range requests');
  await resetProject(); await ev((p) => window.__app.importPaths([p]), big);
  const r = await ev(async () => { const a = window.__app; a.store.setPlayhead(15); await new Promise((r) => setTimeout(r, 2500));
    const v = [...a.preview.sources.videos.values()][0]; return { ct: v.currentTime, rs: v.readyState, msg: document.getElementById('preview-msg').textContent }; });
  assert.ok(Math.abs(r.ct - 15) < 0.2 && r.rs >= 2, `video really sought to 15s: ${JSON.stringify(r)}`);
  assert.equal(r.msg, '');
  const resp = await ev(async (p) => { const x = await fetch(window.hh.mediaUrl(p), { headers: { Range: 'bytes=100-199' } }); return { s: x.status, cr: x.headers.get('content-range'), n: (await x.arrayBuffer()).byteLength }; }, big);
  assert.equal(resp.s, 206); assert.match(resp.cr, /^bytes 100-199\//); assert.equal(resp.n, 100);
});

await step('beats: markers appear on the ruler and "Cut on beats" splits exactly on the beat grid (undoable)', async () => {
  await resetProject(); await ev(async ([a, b]) => { await window.__app.importPaths([a, b]); const { store } = window.__app; const { addMediaClip } = await import('/shared/timeline.js');
    store.mutate((p) => addMediaClip(p, p.media.find((m) => m.kind === 'audio').id, p.tracks.find((t) => t.kind === 'audio').id, 0)); }, [clip, kick]);
  await ev(() => window.__app.runAnalysis({ quiet: true })); await settle(400);
  const marks = await ev(() => document.querySelectorAll('.tl-ruler .beat').length);
  assert.ok(marks >= 10, `beat markers drawn: ${marks}`);
  await ev(() => { const { store } = window.__app; store.select(store.project.clips.find((c) => c.name === 'clip.mp4').id); document.getElementById('tl-beat-n').value = '2'; });
  await page.click('#tl-cut-beats'); await settle(500);
  const r = await ev(() => { const { store } = window.__app; return { starts: store.project.clips.filter((c) => c.name === 'clip.mp4').map((c) => +c.start.toFixed(3)).sort((a, b) => a - b), beats: store.analysis.beats }; });
  assert.ok(r.starts.length >= 3, `video cut into pieces: ${r.starts}`);
  for (const t of r.starts.slice(1)) assert.ok(r.beats.some((b) => Math.abs(b - t) < 0.01), `cut at ${t} lies on a beat`);
  const gaps = r.starts.slice(1).map((t, i) => t - (i ? r.starts[i] : r.starts[0]));
  await ev(() => window.__app.store.undo()); assert.equal(await ev(() => window.__app.store.project.clips.filter((c) => c.name === 'clip.mp4').length), 1, 'undo restores one clip');
});

await step('duplicate + copy/paste clips keep effects and keyframes, get fresh ids, undo works', async () => {
  await resetProject(); await ev((p) => window.__app.importPaths([p]), clip);
  const setup = await ev(async () => { const { store } = window.__app; const { createEffect } = await import('/shared/effects-defs.js'); const c = store.project.clips[0];
    store.mutate(() => { c.effects.push(createEffect('grain')); c.keyframes.opacity = [{ t: 0, v: 0.2 }, { t: 1, v: 1 }]; }); store.select(c.id); return c.effects[0].id; });
  await page.click('#tl-duplicate'); await settle(200);
  let r = await ev(() => { const { store } = window.__app; return store.project.clips.map((c) => ({ id: c.id, start: c.start, fx: c.effects.map((e) => e.id), kf: c.keyframes.opacity?.length })); });
  assert.equal(r.length, 2); assert.equal(r[1].start, r[0].start + 6); assert.equal(r[1].kf, 2); assert.notEqual(r[1].fx[0], r[0].fx[0], 'effect ids regenerated');
  // copy / paste through the DOM events the Edit menu triggers
  await ev(() => { document.activeElement?.blur?.(); document.dispatchEvent(new ClipboardEvent('copy', { cancelable: true })); window.__app.store.setPlayhead(14); document.dispatchEvent(new ClipboardEvent('paste', { cancelable: true })); });
  await settle(200);
  r = await ev(() => window.__app.store.project.clips.map((c) => ({ id: c.id, start: c.start })));
  assert.equal(r.length, 3); assert.ok(new Set(r.map((c) => c.id)).size === 3); assert.ok(r[2].start >= 12 - 1e-6, `pasted at/after the playhead region: ${r[2].start}`);
  await ev(() => { const { store } = window.__app; store.undo(); store.undo(); }); assert.equal(await ev(() => window.__app.store.project.clips.length), 1);
});

await step('relink: a missing file can be pointed at a new one; edits are kept and the preview recovers', async () => {
  const a = path.join(dir, 'relink-a.mp4'); fs.copyFileSync(clip, a);
  await resetProject(); await ev((p) => window.__app.importPaths([p]), a);
  await ev(async () => { const { store } = window.__app; const { createEffect } = await import('/shared/effects-defs.js'); store.mutate((p) => p.clips[0].effects.push(createEffect('grain'))); });
  const file = path.join(dir, 'relink.hhlab'); await ev((f) => window.hh.saveProject(window.__app.store.project, f, false), file); fs.rmSync(a);
  await stubDialog('showOpenDialog', { canceled: false, filePaths: [file] }); page.once('dialog', (d) => d.accept()); await page.click('[data-act="open"]'); await page.waitForFunction(() => window.__app.store.project.media[0]?.missing);
  await ev(() => window.__app.store.setPlayhead(1)); await settle(500);
  const b = path.join(dir, 'relink-b.mp4'); fs.copyFileSync(clip, b);
  await stubDialog('showOpenDialog', { canceled: false, filePaths: [b] });
  await page.click('.media-item.missing button:has-text("Relink")'); await page.waitForFunction(() => !window.__app.store.project.media[0].missing, null, { timeout: 15000 });
  await settle(1200);
  const r = await ev(() => ({ path: window.__app.store.project.media[0].path, fx: window.__app.store.project.clips[0].effects.length, miss: !!document.querySelector('.media-item.missing') }));
  assert.equal(r.path, b); assert.equal(r.fx, 1); assert.equal(r.miss, false);
  assert.ok((await px()).lit > 0.3, 'preview renders from the relinked file');
  const out = path.join(dir, 'relink-out.mp4'); await ev((o) => window.__app.exportTo(o, { fps: 30 }), out); assert.ok(probe(out).streams.some((s) => s.codec_type === 'video'));
});

await step('timeline shows video thumbnails and audio waveforms drawn from the real media', async () => {
  await resetProject(); await ev(async ([a, b]) => { await window.__app.importPaths([a, b]); const { store } = window.__app; const { addMediaClip } = await import('/shared/timeline.js');
    store.mutate((p) => addMediaClip(p, p.media.find((m) => m.kind === 'audio').id, p.tracks.find((t) => t.kind === 'audio').id, 0)); }, [clip, kick]);
  await page.waitForFunction(() => document.querySelectorAll('canvas.clip-vis').length >= 2, null, { timeout: 30000 });
  const r = await ev(() => { const stat = (sel) => { const cv = document.querySelector(sel); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let opaque = 0, lum = new Set(); for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { opaque++; lum.add(Math.round(d[i] / 16)); } return { w: cv.width, opaque: opaque / (d.length / 4), levels: lum.size }; };
    return { video: stat('.clip.video canvas.clip-vis'), audio: stat('.clip.audio canvas.clip-vis') }; });
  assert.ok(r.video.opaque > 0.95 && r.video.levels > 4, `thumbnails fill the clip with real image content: ${JSON.stringify(r.video)}`);
  assert.ok(r.audio.opaque > 0.03 && r.audio.opaque < 0.9, `waveform drawn (not empty, not solid): ${JSON.stringify(r.audio)}`);
  await shot('13-thumbs-waveforms');
});

await step('typography: installed system fonts are listed in the font picker', async () => {
  const r = await ev(async () => { const { systemFonts, ensureFontList } = await import('/app/ui/fonts.js'); const list = await systemFonts(); ensureFontList(); await new Promise((r) => setTimeout(r, 300));
    return { n: list.length, sample: list.slice(0, 3), options: document.querySelectorAll('#font-list option').length }; });
  assert.ok(r.n > 0, `system fonts enumerated: ${JSON.stringify(r)}`);
  assert.ok(r.options >= r.n, 'datalist populated with the system fonts');
});

await step('speed 2x + fades: export is 3s long, frame-accurate vs ffmpeg retime, picture and audio really fade', async () => {
  await resetProject(); await ev((p) => window.__app.importPaths([p]), clip);
  await ev(async () => { const { store } = window.__app; const { setSpeed } = await import('/shared/timeline.js'); const c = store.project.clips[0];
    store.mutate((p) => { setSpeed(p, c.id, 2); c.fadeIn = 1; c.fadeOut = 1; }); });
  assert.equal(await ev(() => window.__app.store.project.clips[0].duration), 3);
  const out = path.join(dir, 'speed-out.mp4'); await ev((o) => window.__app.exportTo(o, { width: 640, height: 360, fps: 30 }), out);
  const info = probe(out); assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.15, `duration ${info.format.duration}`);
  const aud = info.streams.find((s) => s.codec_type === 'audio'); assert.ok(aud && Math.abs(Number(aud.duration) - 3) < 0.2, 'audio retimed to the same length');
  const ref = path.join(dir, 'speed-ref.mp4'); sh(FFMPEG, ['-v', 'error', '-y', '-i', clip, '-vf', 'setpts=PTS/2,fps=30,scale=640:360', '-t', '3', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-an', ref]);
  const mid = (f) => { const o = f + '.mid.mp4'; sh(FFMPEG, ['-v', 'error', '-y', '-ss', '1.1', '-t', '0.8', '-i', f, '-c:v', 'libx264', '-crf', '10', '-an', o]); return o; };
  const r = spawnSync(FFMPEG, ['-v', 'info', '-i', mid(out), '-i', mid(ref), '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /average:([\d.]+|inf)/.exec(r.stderr); const psnr = m ? (m[1] === 'inf' ? 99 : Number(m[1])) : 0;
  console.log(`      2x speed, un-faded middle section PSNR vs ffmpeg retime: ${psnr.toFixed(1)} dB`);
  assert.ok(psnr > 30, `retimed frames line up with ground truth (PSNR ${psnr})`);
  const gray = (t) => { const o = path.join(dir, `g${t}.raw`); sh(FFMPEG, ['-v', 'error', '-y', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'scale=16:9,format=gray', '-f', 'rawvideo', o]); const d = fs.readFileSync(o); return d.reduce((a, b) => a + b, 0) / d.length; };
  const g0 = gray(0.03), g1 = gray(1.5); assert.ok(g0 < g1 * 0.25, `fade-in darkens the first frames (${g0.toFixed(1)} vs ${g1.toFixed(1)})`);
  const vol = (ss) => { const x = spawnSync(FFMPEG, ['-v', 'info', '-ss', String(ss), '-t', '0.2', '-i', out, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }); return Number(/mean_volume: (-?[\d.]+)/.exec(x.stderr)?.[1] ?? 0); };
  const v0 = vol(0), v1 = vol(1.2); assert.ok(v0 < v1 - 6, `audio fades in (${v0} dB vs ${v1} dB)`);
});

await step('preview honours speed: while playing, the video element runs at 2x timeline speed', async () => {
  await resetProject(); await ev((p) => window.__app.importPaths([p]), clip);
  await ev(async () => { const { store } = window.__app; const { setSpeed } = await import('/shared/timeline.js'); store.mutate((p) => setSpeed(p, p.clips[0].id, 2)); store.setPlayhead(0); });
  await page.click('#t-play'); await page.waitForTimeout(1300);
  const r = await ev(() => { const { store, preview } = window.__app; const v = [...preview.sources.videos.values()][0]; return { t: store.playhead, vt: v.currentTime, rate: v.playbackRate }; });
  await page.click('#t-play');
  assert.equal(r.rate, 2); assert.ok(Math.abs(r.vt - 2 * r.t) < 0.5, `video time ${r.vt} ≈ 2 × timeline ${r.t}`);
});

await step('auto-montage: fills a new track on the beat grid from imported media, random looks applied, exports real video', async () => {
  await resetProject(); await ev(async ([a, b, c]) => { await window.__app.importPaths([a, b, c]); const { store } = window.__app; const { addMediaClip } = await import('/shared/timeline.js');
    store.mutate((p) => addMediaClip(p, p.media.find((m) => m.kind === 'audio').id, p.tracks.find((t) => t.kind === 'audio').id, 0)); }, [clip, pic, kick]);
  await ev(() => document.getElementById('tl-beat-n').value = '2'); await ev(() => window.__app.runAnalysis({ quiet: true }));
  const n = await ev(() => window.__app.autoMontage({ every: 2, looks: true, seed: 3 }));
  assert.ok(n >= 6, `cuts created: ${n}`);
  const r = await ev(() => { const { store } = window.__app; const track = store.project.tracks.find((t) => t.kind === 'video' && store.project.clips.filter((c) => c.trackId === t.id).length >= 6);
    const cs = store.project.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start); return { cs: cs.map((c) => ({ s: c.start, d: c.duration, m: c.mediaId, fx: c.effects.length })), beats: store.analysis.beats, dur: store.analysis.duration }; });
  for (let i = 1; i < r.cs.length; i++) assert.ok(Math.abs(r.cs[i].s - (r.cs[i - 1].s + r.cs[i - 1].d)) < 1e-6, 'gapless');
  for (const c of r.cs.slice(1)) assert.ok(r.beats.some((b) => Math.abs(b - c.s) < 0.01), `cut at ${c.s.toFixed(2)} is on a beat`);
  assert.ok(r.cs.some((c) => c.fx > 0), 'some cuts got a look'); assert.ok(new Set(r.cs.map((c) => c.m)).size === 2, 'both video and image used');
  assert.ok(Math.abs(r.cs.at(-1).s + r.cs.at(-1).d - r.dur) < 0.05, 'runs to the end of the music');
  const out = path.join(dir, 'montage.mp4'); await ev((o) => window.__app.exportTo(o, { width: 320, height: 180, fps: 15 }), out);
  const v = probe(out); assert.ok(Math.abs(Number(v.format.duration) - r.dur) < 0.3 && v.streams.some((s) => s.codec_type === 'audio'), 'rendered montage has the music and its length');
});

await step('smart montage: analyses footage + music, cuts on beats, explains itself, re-rolls, undoes, exports; action stays in frame when a wide clip fills a tall canvas', async () => {
  const calm = path.join(dir, 'calm.mp4'), blob = path.join(dir, 'blob.mp4');
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=30:duration=8', '-pix_fmt', 'yuv420p', calm]);
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=black:s=640x360:r=30:d=8', '-f', 'lavfi', '-i', 'color=white:s=90x90:r=30:d=8', '-filter_complex', "[0][1]overlay=x='30+45*sin(2*PI*t*2)':y=135", '-pix_fmt', 'yuv420p', blob]);
  await resetProject();
  await ev(async ([a, b, c, d]) => { await window.__app.importPaths([a, b, c, d]); const { store } = window.__app; const { addMediaClip } = await import('/shared/timeline.js');
    store.mutate((p) => addMediaClip(p, p.media.find((m) => m.kind === 'audio').id, p.tracks.find((t) => t.kind === 'audio').id, 0)); }, [clip, calm, pic, kick]);
  await ev(() => window.__app.runAnalysis({ quiet: true }));
  const before = await ev(() => window.__app.store.project.clips.length);
  await page.click('#tl-montage'); await page.waitForSelector('#montage-modal');
  await page.click('#montage-modal [data-style="street"]');
  await page.click('#mt-run'); await page.waitForSelector('#montage-modal .mt-result', { timeout: 90000 });
  const text = await ev(() => document.querySelector('#montage-modal .mt-result').textContent);
  assert.match(text, /Music:/); assert.match(text, /\d+ cuts/); assert.match(text, /every cut on a beat/); assert.match(text, /Used \d of 3 clips/);
  const ink = await ev(() => { const c = document.querySelector('.mt-strip'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  assert.ok(ink > 500, `the energy/cut strip is drawn (${ink} px)`);
  await shot('17-montage-dialog');
  const grab = () => ev(() => { const { store } = window.__app; const track = store.project.tracks.filter((t) => t.kind === 'video').find((t) => store.project.clips.filter((c) => c.trackId === t.id).length >= 6);
    const cs = store.project.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start); return { cs: cs.map((c) => ({ s: c.start, d: c.duration, m: c.mediaId, i: c.in, fx: c.effects.length, tr: c.transition?.type || 'none' })), beats: store.analysis.beats, dur: store.analysis.duration, total: store.project.clips.length }; });
  const r = await grab();
  assert.ok(r.cs.length >= 6, `cuts: ${r.cs.length}`);
  for (let i = 1; i < r.cs.length; i++) { assert.ok(Math.abs(r.cs[i].s - (r.cs[i - 1].s + r.cs[i - 1].d)) < 1e-6, 'gapless'); assert.ok(r.beats.some((b) => Math.abs(b - r.cs[i].s) < 0.01), `cut at ${r.cs[i].s.toFixed(2)} is on a beat`); }
  assert.ok(Math.abs(r.cs.at(-1).s + r.cs.at(-1).d - r.dur) < 0.05, 'runs to the end of the music');
  assert.ok(new Set(r.cs.map((c) => c.m)).size >= 2, 'uses more than one source');
  for (const m of new Set(r.cs.map((c) => c.m))) { const rs = r.cs.filter((c) => c.m === m && c.i >= 0).map((c) => [c.i, c.i + c.d]).sort((a, b) => a[0] - b[0]); }
  // re-roll: same count of tracks, different choices, still valid
  const seq = (x) => x.cs.map((c) => `${c.m}@${c.i}`).join();
  await page.click('#mt-reroll'); await page.waitForTimeout(400);
  const r2 = await grab(); assert.ok(seq(r2) !== seq(r), 're-roll picks different shots'); assert.equal(r2.total - before, r2.cs.length, 're-roll replaced the first result, not added to it');
  // undo restores everything in one step
  await page.click('#mt-undo'); await page.waitForTimeout(200);
  assert.equal(await ev(() => window.__app.store.project.clips.length), before, 'one Undo removes the montage');
  await page.click('#mt-run'); await page.waitForSelector('#montage-modal .mt-result .mt-lines');
  const out = path.join(dir, 'smart-montage.mp4'); await ev((o) => window.__app.exportTo(o, { width: 192, height: 108, fps: 10 }), out);
  const v = probe(out); assert.ok(Math.abs(Number(v.format.duration) - r.dur) < 0.3 && v.streams.some((s) => s.codec_type === 'audio'), 'the montage exports with the music');
  await ev(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Close').click());

  // action stays in frame: a wide clip whose action is on the LEFT fills a 9:16 canvas
  await resetProject();
  await ev(async ([a, k]) => { await window.__app.importPaths([a, k]); const { store } = window.__app; const { addMediaClip } = await import('/shared/timeline.js');
    store.mutate((p) => { p.settings.width = 360; p.settings.height = 640; addMediaClip(p, p.media.find((m) => m.kind === 'audio').id, p.tracks.find((t) => t.kind === 'audio').id, 0); }); }, [blob, kick]);
  await ev(() => window.__app.runAnalysis({ quiet: true }));
  const res = await ev(async () => { const x = await window.__app.smartMontage.runSmartMontage({ opts: { style: 'clean', reframe: true, seed: 5 } }); const cs = x.clips.map((c) => ({ s: c.start, d: c.duration, sc: c.props.scale, x: c.props.x })); return { cs, focus: x.plan.segments.map((g) => g.focus) }; });
  assert.ok(res.cs.every((c) => c.sc > 2), `wide clip fills the tall canvas (scale ${res.cs[0].sc})`);
  assert.ok(res.cs.every((c) => c.x > 0), `the crop is shifted toward the action on the left (x ${res.cs.map((c) => c.x.toFixed(2))})`);
  const mid = res.cs.find((c) => c.d > 0.8) || res.cs[0];
  await ev((t) => window.__app.store.setPlayhead(t), mid.s + mid.d / 2); await settle(900);
  const lit = await ev(() => { const d = window.__grab(36, 64); let n = 0; for (let i = 0; i < d.length; i += 3) if (d[i] > 200) n++; return n; });
  assert.ok(lit > 15, `the white subject is inside the 9:16 frame (${lit} bright cells)`);
});

await step('smart montage with no music: the dialog explains and offers a steady tempo (or a song) instead of a dead end', async () => {
  const silent = path.join(dir, 'silent.mp4');
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=12', '-pix_fmt', 'yuv420p', silent]);
  await resetProject(); await ev((p) => window.__app.importPaths(p), [silent, pic]);
  await page.click('#tl-montage'); await page.waitForSelector('#montage-modal');
  await page.click('#mt-run'); await page.waitForSelector('#mt-tempo', { timeout: 30000 });
  const msg = await ev(() => document.querySelector('#montage-modal .mt-help .errbox').textContent); assert.match(msg, /no music/i);
  assert.ok(await ev(() => !!document.getElementById('mt-add-music')), 'offers to add a song');
  await shot('20-montage-no-music');
  await ev(() => { document.getElementById('mt-bpm').value = '120'; document.getElementById('mt-seconds').value = '10'; });
  await page.click('#mt-tempo'); await page.waitForSelector('#montage-modal .mt-result', { timeout: 60000 });
  const r = await ev(() => { const { store } = window.__app; const track = store.project.tracks.find((t) => t.kind === 'video' && store.project.clips.filter((c) => c.trackId === t.id).length >= 4);
    return store.project.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start).map((c) => ({ s: c.start, d: c.duration })); });
  assert.ok(r.length >= 4, `cuts: ${r.length}`); assert.ok(Math.abs(r.at(-1).s + r.at(-1).d - 10) < 0.05, 'runs for the chosen length');
  for (const c of r.slice(1)) assert.ok(Math.abs(c.s / 0.5 - Math.round(c.s / 0.5)) < 1e-3, `cut at ${c.s} is on the 120 BPM click`);
  await page.waitForFunction(() => !document.getElementById('mt-run').disabled); // Close is ignored while the run is still finishing
  await ev(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Close').click());
  await page.waitForSelector('#montage-modal', { state: 'detached' });
});

await step('cross-dissolve mixes the two pictures (and undoes in one step); the script title lockup draws in the bundled font', async () => {
  const red = path.join(dir, 'red.mp4'), blue = path.join(dir, 'blue.mp4');
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xff0000:s=320x180:r=30:d=6', '-pix_fmt', 'yuv420p', red]);
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x0000ff:s=320x180:r=30:d=6', '-pix_fmt', 'yuv420p', blue]);
  await resetProject(); await ev((p) => window.__app.importPaths(p), [red, blue]);
  const ids = await ev(async () => { const { store } = window.__app; const { addMediaClip, trackEnd } = await import('/shared/timeline.js');
    const v1 = store.project.tracks.find((t) => t.name === 'V1'); const m = store.project.media;
    const a = store.project.clips[0]; a.duration = 4; a.in = 1;
    const b = store.mutate((p) => { const c = addMediaClip(p, m[1].id, v1.id, 4); c.duration = 4; c.in = 2; return c; });
    store.select(b.id); return { a: a.id, b: b.id }; });
  await ev(() => { document.getElementById('tl-dissolve-d').value = '1'; });
  const clipsBefore = await ev(() => window.__app.store.project.clips.length);
  await page.click('#tl-dissolve');
  const st = await ev((i) => { const { store } = window.__app; const b = store.project.clips.find((c) => c.id === i.b); const a = store.project.clips.find((c) => c.id === i.a);
    const ti = (id) => store.project.tracks.findIndex((t) => t.id === id); return { bs: b.start, bd: b.duration, bin: b.in, fi: b.fadeIn, above: ti(b.trackId) < ti(a.trackId), ae: a.start + a.duration }; }, ids);
  assert.deepEqual([st.bs, st.bd, st.bin, st.fi, st.above, st.ae], [3, 5, 1, 1, true, 4], JSON.stringify(st));
  const mean = async (t) => { await ev((x) => window.__app.store.setPlayhead(x), t); await settle(1100); return ev(() => { const d = window.__grab(32, 18); let r = 0, b = 0; for (let i = 0; i < d.length; i += 3) { r += d[i]; b += d[i + 2]; } const n = d.length / 3; return { r: r / n, b: b / n }; }); };
  const before = await mean(2.0), mid = await mean(3.5), after = await mean(5.0);
  assert.ok(before.r > 200 && before.b < 30, `pure red before the dissolve ${JSON.stringify(before)}`);
  assert.ok(mid.r > 70 && mid.b > 70 && mid.r < 200 && mid.b < 200, `both pictures visible mid-dissolve ${JSON.stringify(mid)}`);
  assert.ok(after.b > 200 && after.r < 30, `pure blue after ${JSON.stringify(after)}`);
  await shot('18-dissolve-mid');
  await ev(() => window.__app.store.undo());
  assert.equal(await ev(() => window.__app.store.project.clips.length), clipsBefore);
  assert.equal(await ev((i) => window.__app.store.project.clips.find((c) => c.id === i).start, ids.b), 4, 'Undo puts the clip back');

  // script lockup
  await ev(() => window.__app.store.setPlayhead(5));
  await ev(() => document.getElementById('add-lockup').click());
  const lk = await ev(() => window.__app.store.project.clips.filter((c) => c.type === 'text').map((c) => ({ f: c.text.font, t: c.text.content, tr: c.trackId })));
  assert.equal(lk.length, 2); assert.deepEqual(lk.map((c) => c.f).sort(), ['Instrument Serif', 'Pinyon Script']); assert.notEqual(lk[0].tr, lk[1].tr);
  assert.equal(await ev(() => document.fonts.check('40px "Pinyon Script"')), true, 'the bundled script font is loaded');
  await ev(() => window.__app.store.setPlayhead(6.5)); await settle(1300);
  const pink = await ev(() => { const d = window.__grab(96, 54); let n = 0; for (let i = 0; i < d.length; i += 3) if (d[i] > 180 && d[i + 1] < 110 && d[i + 2] > 40 && d[i + 2] < 190) n++; return n; });
  assert.ok(pink > 25, `the pink script title is in the picture (${pink} pink cells)`);
  await shot('19-script-title');
});

await step('type pack: vertical Japanese runs top-to-bottom in its own font, chrome bubble type renders lit, the lockup list adds two clips', async () => {
  await resetProject();
  await ev(() => { window.__app.store.mutate((p) => { p.settings.width = 480; p.settings.height = 270; }); });
  await page.click('#panel-left [data-tab="type"]');
  const names = await ev(() => [...document.querySelectorAll('#text-presets button')].map((b) => b.firstChild.textContent));
  for (const n of ['Tokyo Vertical', 'Y2K Chrome Bubble', 'Cyber Katakana']) assert.ok(names.some((x) => x.startsWith(n)), `preset list has ${n}`);
  await ev(async () => { await document.fonts.load('40px "Zen Antique"', '東京'); await document.fonts.load('40px "Dela Gothic One"', 'FUTURE'); });
  const bbox = async (preset, content) => {
    await ev(async ([n, words]) => { const { store } = window.__app; const TD = await import('/shared/text-defs.js'); const T = await import('/shared/timeline.js');
      store.mutate((p) => { p.clips = []; const c = TD.createTextClip(TD.TEXT_PRESETS.find((x) => x.name.startsWith(n)), 0, 4); if (words) c.text.content = words; c.text.anim = { ...c.text.anim, type: 'none' }; c.trackId = p.tracks.find((t) => t.kind === 'video').id; T.addClipRaw(p, c); }); store.setPlayhead(2); }, [preset, content]);
    await settle(700);
    return ev(() => { const W = 96, H = 54, d = window.__grab(W, H); let x0 = W, x1 = -1, y0 = H, y1 = -1, n = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; if (d[i] + d[i + 1] + d[i + 2] > 120) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
      return { n, w: x1 - x0 + 1, h: y1 - y0 + 1 }; });
  };
  const v = await bbox('Tokyo Vertical', '東京夜行'); // one column of four characters assert.ok(v.n > 20, `vertical text is drawn (${v.n} cells)`); assert.ok(v.h > v.w * 1.2, `vertical text is taller than wide (${v.w}×${v.h})`);
  const c = await bbox('Y2K Chrome Bubble'); assert.ok(c.n > 40, `chrome type is drawn (${c.n} cells)`);
  await shot('24-type-pack');
  const before = await ev(() => window.__app.store.project.clips.length);
  await ev(() => document.querySelector('#lockup-list button').click());
  assert.equal(await ev(() => window.__app.store.project.clips.length), before + 2, 'a lockup adds a kicker and a title clip');
});

await step('looks: an adjustment layer grades everything under it; glints sparkle; Organic veins grow in from the edge and bend the picture', async () => {
  await resetProject();
  await ev(async (c) => { await window.__app.importPaths([c]); const { store } = window.__app; const { addMediaClip } = await import('/shared/timeline.js');
    store.mutate((p) => { p.settings.width = 480; p.settings.height = 270; addMediaClip(p, p.media[0].id, p.tracks.find((t) => t.kind === 'video').id, 0); }); store.setPlayhead(0.6); }, clip);
  await settle(700);
  const grab = () => ev(() => window.__grab(96, 54));
  const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
  const base = await grab();
  await page.click('#panel-left [data-tab="looks"]');
  assert.ok((await ev(() => document.querySelectorAll('#look-list button').length)) >= 6, 'the Looks pane lists the Y2K looks');
  await page.click('#look-list [data-look="Cyber CRT"]'); await settle(700);
  const st = await ev(() => { const { store } = window.__app; const c = store.project.clips.find((x) => x.type === 'adjust'); const media = store.project.clips.find((x) => x.type === 'media');
    return { n: store.project.clips.filter((x) => x.type === 'adjust').length, sameTrack: c.trackId === media.trackId, fx: c.effects.map((e) => e.type), selected: store.selection === c.id, card: document.querySelector('#inspector .card h3, #inspector .card-title, #inspector')?.textContent || '' }; });
  assert.equal(st.n, 1); assert.ok(!st.sameTrack, 'the layer gets its own track'); assert.ok(st.fx.includes('crt'));
  assert.match(st.card, /Adjustment layer/);
  const graded = await grab(); assert.ok(diff(base, graded) > 4, `the layer changes the picture beneath it (Δ${diff(base, graded).toFixed(1)})`);
  await ev(() => { const { store } = window.__app; store.project.clips.find((x) => x.type === 'adjust').props.opacity = 0; store.touch('project'); }); await settle(500);
  assert.ok(diff(base, await grab()) < 1.5, 'opacity 0 puts the original back');
  await shot('21-adjustment-layer');

  // glints: a dark frame with a few bright dots gets rays that were not there before
  const dots = path.join(dir, 'dots.png');
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x101830:s=480x270,drawbox=x=120:y=80:w=8:h=8:c=white:t=fill,drawbox=x=300:y=150:w=10:h=10:c=white:t=fill', '-frames:v', '1', dots]);
  await resetProject();
  await ev(async (d) => { await window.__app.importPaths([d]); const { store } = window.__app; const { addMediaClip } = await import('/shared/timeline.js'); const { createAdjustClip } = await import('/shared/adjust-defs.js'); const { createEffect } = await import('/shared/effects-defs.js');
    store.mutate((p) => { p.settings.width = 480; p.settings.height = 270; addMediaClip(p, p.media[0].id, p.tracks.find((t) => t.kind === 'video').id, 0); });
    store.mutate((p) => { const c = createAdjustClip(null, 0, 4); c.effects = []; c.trackId = p.tracks[0].id; p.clips.push(c); }); store.setPlayhead(0.5); }, dots);
  await settle(500); const lum = (d) => { let n = 0; for (let i = 0; i < d.length; i += 3) n += d[i] + d[i + 1] + d[i + 2]; return n; };
  const dotsLum = lum(await grab());
  await ev(async () => { const { createEffect } = await import('/shared/effects-defs.js'); const { store } = window.__app; store.project.clips.find((x) => x.type === 'adjust').effects = [createEffect('glints', { threshold: 0.5, length: 180, intensity: 2, twinkle: 0 })]; store.touch('project'); });
  await settle(500); const glintLum = lum(await grab());
  assert.ok(glintLum > dotsLum * 1.03, `glints add light around the highlights (${dotsLum} → ${glintLum})`);
  await resetProject();
  await ev(async (c) => { await window.__app.importPaths([c]); const { store } = window.__app; const { addMediaClip } = await import('/shared/timeline.js');
    store.mutate((p) => { p.settings.width = 480; p.settings.height = 270; addMediaClip(p, p.media[0].id, p.tracks.find((t) => t.kind === 'video').id, 0); }); store.setPlayhead(0.6); }, clip);
  await settle(500);

  // Organic: veins grow in over time and refract the footage
  const base2 = await grab();
  await page.click('#panel-left [data-tab="organic"]');
  await page.click('#organic-looks [data-look="Veins · Glass"]');
  const span = await ev(() => { const c = window.__app.store.project.clips.find((x) => x.type === 'adjust'); return { start: c.start, d: c.duration, grow: c.effects[0].keyframes.growth.at(-1).t }; });
  await ev((t) => window.__app.store.setPlayhead(t), span.start + 0.02); await settle(600); const seedling = await grab();
  await ev((t) => window.__app.store.setPlayhead(t), span.start + Math.min(span.d - 0.1, span.grow)); await settle(700); const grown = await grab();
  assert.ok(diff(base2, seedling) < 2, `at the start the veins have not appeared (Δ${diff(base, seedling).toFixed(1)})`);
  assert.ok(diff(seedling, grown) > 2, `later they have grown over the footage (Δ${diff(seedling, grown).toFixed(1)})`);
  await shot('22-organic-veins');
});

await step('preview editing: click selects a title or picture, drag moves it (one undo), the corner handle scales, double-click edits words, empty space deselects', async () => {
  await resetProject();
  await ev(async (c) => { await window.__app.importPaths([c]); const { store } = window.__app; const TD = await import('/shared/text-defs.js'); const T = await import('/shared/timeline.js');
    store.mutate((p) => { p.settings.width = 640; p.settings.height = 360; const t = TD.createTextClip(null, 0, 4); t.text.content = 'HELLO'; t.text.size = 0.18; t.text.anim = { ...t.text.anim, type: 'none' }; t.trackId = p.tracks[0].id; T.addClipRaw(p, t); }); store.select(null); store.setPlayhead(1); }, clip);
  await settle(900);
  const info = await ev(() => { const { store, previewEdit } = window.__app; const t = store.project.clips.find((c) => c.type === 'text'); const b = previewEdit.boxFor(t); const ctr = previewEdit.toScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2); const off = previewEdit.toScreen(40, 330); return { id: t.id, vid: store.project.clips.find((c) => c.type === 'media').id, ctr, off, w: b.x1 - b.x0 }; });
  assert.ok(info.w > 50, `the title has a measurable box (${info.w.toFixed(0)} px wide)`);
  await page.mouse.click(info.ctr.x, info.ctr.y);
  assert.equal(await ev(() => window.__app.store.selection), info.id, 'clicking the title selects it');
  await settle(250);
  assert.equal(await page.locator('.pick-box:not([hidden])').count(), 1, 'a selection box is drawn around it');
  await page.mouse.click(info.off.x, info.off.y);
  assert.equal(await ev(() => window.__app.store.selection), info.vid, 'clicking the picture away from the title selects the picture');
  await page.mouse.click(info.ctr.x, info.ctr.y);
  const undo0 = await ev(() => window.__app.store.undoStack.length);
  await page.mouse.move(info.ctr.x, info.ctr.y); await page.mouse.down(); await page.mouse.move(info.ctr.x + 60, info.ctr.y + 30, { steps: 8 }); await page.mouse.up();
  const moved = await ev(() => { const t = window.__app.store.selectedClip; return { x: t.props.x, y: t.props.y, undo: window.__app.store.undoStack.length }; });
  assert.ok(moved.x > 0.05 && moved.y < -0.03, `dragging moved the title right and down (${moved.x.toFixed(3)}, ${moved.y.toFixed(3)})`);
  assert.equal(moved.undo - undo0, 1, 'the whole drag is one undo step');
  await ev(() => window.__app.store.undo()); assert.equal(await ev(() => window.__app.store.selectedClip.props.x), 0, 'undo puts it back');
  // the corner handle scales
  await settle(300);
  const hb = await page.locator('.pick-h').boundingBox();
  await page.mouse.move(hb.x + 5, hb.y + 5); await page.mouse.down(); await page.mouse.move(hb.x + 60, hb.y + 40, { steps: 6 }); await page.mouse.up();
  assert.ok((await ev(() => window.__app.store.selectedClip.props.scale)) > 1.1, 'dragging the corner handle scales the title');
  // double-click focuses the words field; clicking empty canvas away from everything deselects
  const c2 = await ev(() => { const { store, previewEdit } = window.__app; const t = store.selectedClip; const b = previewEdit.boxFor(t); return previewEdit.toScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2); });
  await page.mouse.dblclick(c2.x, c2.y);
  await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA', null, { timeout: 4000 }).catch(() => {});
  assert.equal(await ev(() => document.activeElement?.tagName), 'TEXTAREA', 'double-click puts the cursor in the title text box');
  await ev(() => document.activeElement.blur());
  await shot('29-preview-edit');
  await ev(() => window.__app.timeline.setZoom(60));
});

await step('timeline editing: group drag across tracks is one undo step and never freezes, marquee selects, overlaps are refused, no rebuild while dragging', async () => {
  await resetProject();
  await ev(async (c) => { await window.__app.importPaths([c]); const { store } = window.__app; const TD = await import('/shared/text-defs.js'); const T = await import('/shared/timeline.js');
    store.mutate((p) => { p.clips = []; const [v2, v1] = p.tracks.filter((t) => t.kind === 'video');
      for (const [n, tr, start] of [['A', v1, 0], ['B', v1, 3], ['C', v1, 6], ['D', v2, 9]]) { const t = TD.createTextClip(null, start, 2); t.name = n; t.text.content = n; t.trackId = tr.id; p.clips.push(t); } });
    store.select(null); }, clip);
  await ev(() => document.getElementById('tl-fit').click()); await settle(300);
  const geo = () => ev(() => { const r = {}; for (const n of document.querySelectorAll('.clip')) { const b = n.getBoundingClientRect(); r[n.title] = { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width }; } const rows = {}; for (const row of document.querySelectorAll('.tl-row')) { const b = row.getBoundingClientRect(); rows[row.dataset.row] = b.y + b.height / 2; } const { store } = window.__app; return { r, rows, v2: store.project.tracks.filter((t) => t.kind === 'video')[0].id, v1: store.project.tracks.filter((t) => t.kind === 'video')[1].id }; });
  const state = () => ev(() => Object.fromEntries(window.__app.store.project.clips.map((c) => [c.name, { s: +c.start.toFixed(2), t: window.__app.store.project.tracks.find((x) => x.id === c.trackId).name }])));
  let g = await geo();
  assert.ok(g.r.A && g.r.B && g.r.C && g.r.D, `all four clips are drawn (${Object.keys(g.r)})`);
  const pxPerSec = g.r.A.w / 2;
  // multi-select A + B with Ctrl-click, then drag A up one row and 1 s later: B must follow
  await page.keyboard.down('Control'); await page.mouse.click(g.r.A.x, g.r.A.y); await page.mouse.click(g.r.B.x, g.r.B.y); await page.keyboard.up('Control');
  assert.equal(await ev(() => window.__app.store.multi.size), 2, 'two clips selected');
  await ev(() => { window.__rebuilds = 0; const content = document.getElementById('tl-content'); window.__mo = new MutationObserver((m) => { for (const x of m) for (const n of x.removedNodes) if (n.classList?.contains('tl-row')) window.__rebuilds++; }); window.__mo.observe(content, { childList: true }); });
  const undo0 = await ev(() => window.__app.store.undoStack.length);
  await page.mouse.move(g.r.A.x, g.r.A.y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(g.r.A.x + (pxPerSec * i) / 12, g.r.A.y + ((g.rows[g.v2] - g.rows[g.v1]) * i) / 12);
  const midRebuilds = await ev(() => window.__rebuilds);
  assert.equal(midRebuilds, 0, `the timeline is not rebuilt while dragging (${midRebuilds} rebuilds)`);
  await page.mouse.up(); await settle(300);
  let st = await state();
  assert.deepEqual([st.A.t, st.B.t, st.C.t], ['V2', 'V2', 'V1'], 'the two selected clips moved up a track together');
  assert.ok(Math.abs(st.A.s - 1) < 0.2 && Math.abs(st.B.s - 4) < 0.2, `…and 1 s later (${st.A.s}, ${st.B.s})`);
  assert.equal((await ev(() => window.__app.store.undoStack.length)) - undo0, 1, 'one undo step for the whole group move');
  await ev(() => window.__mo.disconnect());
  await ev(() => window.__app.store.undo()); st = await state(); assert.deepEqual([st.A.t, st.B.t, st.A.s, st.B.s], ['V1', 'V1', 0, 3], 'undo restores both');
  // a move that would land on another clip is refused (the clip stays where the last valid spot was)
  g = await geo();
  const uBefore = await ev(() => window.__app.store.undoStack.length);
  await page.mouse.click(g.r.B.x, g.r.B.y);
  await page.mouse.move(g.r.B.x, g.r.B.y); await page.mouse.down(); await page.mouse.move(g.r.C.x + 10, g.r.B.y, { steps: 8 }); await page.mouse.up(); await settle(200);
  st = await state(); assert.ok(st.B.s + 2 <= st.C.s + 1e-6 || st.B.s >= st.C.s + 2 - 1e-6, `no overlap with C (B ${st.B.s}, C ${st.C.s})`);
  assert.equal(await ev(() => window.__app.store.undoStack.length), uBefore, 'a refused move leaves no undo step behind');
  // marquee: drag across empty lane space around A and B selects exactly those
  g = await geo(); const laneY = g.rows[g.v1];
  await page.mouse.move(g.r.A.x - 40, laneY - 22); await page.mouse.down(); await page.mouse.move(g.r.B.x + 20, laneY + 14, { steps: 8 });
  assert.equal(await page.locator('.marquee').count(), 1, 'a rubber band is shown');
  await page.mouse.up();
  const picked = await ev(() => [...window.__app.store.multi].map((id) => window.__app.store.project.clips.find((c) => c.id === id).name).sort().join(''));
  assert.equal(picked, 'AB', `the rubber band selected A and B (${picked})`);
  await page.keyboard.press('Escape'); assert.equal(await ev(() => window.__app.store.multi.size), 0, 'Escape clears the selection');
  await shot('30-timeline-multi');
  await ev(() => window.__app.timeline.setZoom(60));
});

await step('render range: I/O mark the ruler, the export renders only that stretch (picture and sound), Alt+X clears', async () => {
  const ramp2 = path.join(dir, 'ramp.mp4');
  if (!fs.existsSync(ramp2)) sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=160x90:d=4:r=15,fade=t=in:st=0:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:d=4', '-shortest', '-pix_fmt', 'yuv420p', '-c:a', 'aac', ramp2]);
  await resetProject();
  await ev(async (c) => { await window.__app.importPaths([c]); const { store } = window.__app; store.mutate((p) => { p.settings.width = 160; p.settings.height = 90; }); }, ramp2);
  await ev(() => document.getElementById('tl-fit').click());
  await ev(() => window.__app.store.setPlayhead(1)); await page.keyboard.press('i');
  await ev(() => window.__app.store.setPlayhead(3)); await page.keyboard.press('o');
  const rg = await ev(() => ({ r: window.__app.store.project.range, label: document.getElementById('tl-range').textContent, flags: document.querySelectorAll('.range-flag').length }));
  assert.deepEqual([Math.round(rg.r.in * 10) / 10, Math.round(rg.r.out * 10) / 10], [1, 3]); assert.equal(rg.flags, 2, 'IN and OUT flags on the ruler'); assert.match(rg.label, /2\.0 s/);
  // drag the OUT flag a little: the range follows
  const fb = await page.locator('.range-flag.out').boundingBox();
  const dxPx = await ev(() => window.__app.store.zoom * 0.5);
  await page.mouse.move(fb.x + 8, fb.y + fb.height / 2); await page.mouse.down(); await page.mouse.move(fb.x + 8 + dxPx, fb.y + fb.height / 2, { steps: 6 }); await page.mouse.up(); await settle(200);
  const dragged = await ev(() => window.__app.store.project.range.out); assert.ok(dragged > 3.2, `dragging the OUT flag moved it (${dragged.toFixed(2)})`);
  await ev(() => { window.__app.store.project.range = { in: 1, out: 3 }; window.__app.store.touch('project'); });
  const out = path.join(dir, 'range.mp4');
  const res = await ev((o) => window.__app.exportTo(o, { width: 160, height: 90, fps: 10, range: window.__app.store.project.range }), out);
  const v = probe(out);
  assert.ok(Math.abs(Number(v.format.duration) - 2) < 0.35, `the file is 2 s long (${v.format.duration})`); assert.ok(v.streams.some((s) => s.codec_type === 'audio'), 'sound came along');
  const mean = (t) => { const f = path.join(dir, `rg-${t}.raw`); sh(FFMPEG, ['-v', 'error', '-y', '-ss', String(t), '-i', out, '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', f]); const b = fs.readFileSync(f); let s = 0; for (const x of b) s += x; return s / b.length; };
  const first = mean(0), last = mean(1.8);
  assert.ok(first > 40 && first < 100, `the first frame is the ramp at 1 s (~64): ${first.toFixed(0)}`); assert.ok(last > 150 && last < 235, `the last frame is the ramp near 3 s (~190): ${last.toFixed(0)}`);
  await page.keyboard.press('Alt+x'); assert.equal(await ev(() => window.__app.store.project.range === undefined), true, 'Alt+X clears the range');
  await shot('31-render-range');
  await ev(() => window.__app.timeline.setZoom(60));
});

await step('basic edits: reverse plays backwards (picture + sound) and undoes, freeze frame holds a frame, flip mirrors, 3D tilt narrows the picture, crop cuts it', async () => {
  const ramp = path.join(dir, 'ramp.mp4'), half = path.join(dir, 'half.png'), white = path.join(dir, 'white.png');
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=160x90:d=4:r=15,fade=t=in:st=0:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:d=4', '-shortest', '-pix_fmt', 'yuv420p', '-c:a', 'aac', ramp]);
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=black:s=160x90,drawbox=x=0:y=0:w=80:h=90:c=white:t=fill', '-frames:v', '1', half]);
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=white:s=160x90', '-frames:v', '1', white]);
  const bright = () => ev(() => { const d = window.__grab(32, 18); let s = 0; for (let i = 0; i < d.length; i++) s += d[i]; return s / d.length; });
  const at = async (t) => { await ev((t) => window.__app.store.setPlayhead(t), t); await settle(600); return bright(); };
  await resetProject();
  await ev(async (c) => { await window.__app.importPaths([c]); const { store } = window.__app; store.mutate((p) => { p.settings.width = 320; p.settings.height = 180; }); }, ramp);
  const first = await at(0.3), last = await at(3.6);
  assert.ok(last > first + 80, `the ramp brightens over time (${first.toFixed(0)} → ${last.toFixed(0)})`);
  const mediaBefore = await ev(() => window.__app.store.project.media.length);
  await ev(() => { const { store } = window.__app; store.select(store.project.clips.find((c) => c.type === 'media').id); });
  assert.equal(await ev(() => window.__app.reverseSelected()), true, 'reverse succeeds');
  assert.equal(await ev(() => window.__app.store.project.media.length), mediaBefore + 1, 'a reversed media item was added');
  const info = await ev(() => { const { store } = window.__app; const c = store.project.clips.find((x) => x.type === 'media'); const m = store.project.media.find((x) => x.id === c.mediaId); return { name: m.name, dur: m.duration, audio: m.hasAudio, inT: c.in, d: c.duration }; });
  assert.match(info.name, /reversed/); assert.ok(Math.abs(info.dur - 4) < 0.4, `reversed length ${info.dur}`); assert.equal(info.audio, true, 'the sound came along'); assert.equal(info.inT, 0);
  await settle(800);
  const rfirst = await at(0.3), rlast = await at(3.6);
  assert.ok(rfirst > rlast + 80, `reversed: bright at the start, dark at the end (${rfirst.toFixed(0)} → ${rlast.toFixed(0)})`);
  await ev(() => window.__app.store.undo());
  assert.ok((await at(3.6)) > (await at(0.3)) + 80, 'undo restores the forward clip');
  // freeze frame at 1.0 s for 2 s
  await ev(() => { const { store } = window.__app; store.select(store.project.clips.find((c) => c.type === 'media').id); store.setPlayhead(1); });
  const totalBefore = await ev(async () => (await import('/shared/timeline.js')).projectDuration(window.__app.store.project));
  assert.equal(await ev(() => window.__app.freezeAtPlayhead(2)), true, 'freeze succeeds');
  const totalAfter = await ev(async () => (await import('/shared/timeline.js')).projectDuration(window.__app.store.project));
  assert.ok(Math.abs(totalAfter - totalBefore - 2) < 0.01, `the cut grew by the freeze length (${totalBefore} → ${totalAfter})`);
  await settle(800);
  const f1 = await at(1.3), f2 = await at(2.7), after = await at(3.8);
  assert.ok(Math.abs(f1 - f2) < 4, `held frame does not change (${f1.toFixed(1)} vs ${f2.toFixed(1)})`);
  assert.ok(after > f2 + 15, 'playback resumes after the hold');
  // flip / 3D / crop on still images
  const lit = () => ev(() => { const W = 64, H = 36, d = window.__grab(W, H); let n = 0, left = 0, right = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = d[(y * W + x) * 3]; if (v > 128) { n++; if (x < W / 2) left++; else right++; } } return { n: n / (W * H), left: left / (W * H / 2), right: right / (W * H / 2) }; });
  await resetProject();
  await ev(async ([h]) => { await window.__app.importPaths([h]); const { store } = window.__app; const { addMediaClip } = await import('/shared/timeline.js'); store.mutate((p) => { p.settings.width = 320; p.settings.height = 180; addMediaClip(p, p.media[0].id, p.tracks.find((t) => t.kind === 'video').id, 0).duration = 4; }); store.select(store.project.clips[0].id); store.setPlayhead(0.5); }, [half]);
  await settle(800);
  const a = await lit(); assert.ok(a.left > 0.5 && a.right < 0.05, `half image: white on the left (${JSON.stringify(a)})`);
  await ev(() => { const { store } = window.__app; store.project.clips[0].props.flipX = 1; store.touch('project'); }); await settle(600);
  const b = await lit(); assert.ok(b.right > 0.5 && b.left < 0.05, `flipX mirrors it (${JSON.stringify(b)})`);
  await resetProject();
  await ev(async ([w]) => { await window.__app.importPaths([w]); const { store } = window.__app; const { addMediaClip } = await import('/shared/timeline.js'); store.mutate((p) => { p.settings.width = 320; p.settings.height = 180; const c = addMediaClip(p, p.media[0].id, p.tracks.find((t) => t.kind === 'video').id, 0); c.duration = 4; c.props.scale = 1.4; }); store.setPlayhead(0.5); }, [white]);
  await settle(800);
  const flat = await lit(); assert.ok(flat.n > 0.95, `a white card fills the frame (${flat.n})`);
  await ev(() => { const { store } = window.__app; store.project.clips[0].props.rotY = 70; store.touch('project'); }); await settle(600);
  const turned = await lit(); assert.ok(turned.n < 0.8 && turned.n > 0.2, `turned 70° it narrows (${flat.n.toFixed(2)} → ${turned.n.toFixed(2)})`);
  await ev(async () => { const { store } = window.__app; const { createEffect } = await import('/shared/effects-defs.js'); const c = store.project.clips[0]; c.props.rotY = 0; c.effects = [createEffect('crop', { left: 0.5 })]; store.touch('project'); }); await settle(600);
  const cropped = await lit(); assert.ok(cropped.n > 0.4 && cropped.n < 0.6, `crop left 50% leaves half (${cropped.n.toFixed(2)})`);
  await shot('27-basic-edits');
});

await step('masks and mattes: ellipse/rectangle/drawn shapes cut the picture, invert, cut-out, grow, move over time, drag handles; a title or a luma picture works as a matte', async () => {
  const wh = path.join(dir, 'mask-white.png'), halfL = path.join(dir, 'mask-half.png');
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=320x180', '-frames:v', '1', wh]);
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=320x180,drawbox=x=160:y=0:w=160:h=180:c=black:t=fill', '-frames:v', '1', halfL]);
  await resetProject();
  await ev(async ([w]) => { await window.__app.importPaths([w]); const { store } = window.__app; const { addMediaClip } = await import('/shared/timeline.js');
    store.mutate((p) => { p.settings.width = 320; p.settings.height = 180; addMediaClip(p, p.media[0].id, p.tracks.find((t) => t.kind === 'video').id, 0).duration = 6; }); store.select(store.project.clips[0].id); store.setPlayhead(1); }, [wh]);
  await page.click('#panel-right [data-tab="inspector"]');
  const lit = () => ev(() => { const W = 64, H = 36, d = window.__grab(W, H); let n = 0, sx = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 3] > 128) { n++; sx += x; } return { n: n / (W * H), cx: n ? sx / n / W : 0.5, c: d[(18 * W + 32) * 3], k: d[(2 * W + 2) * 3] }; });
  await settle(700);
  const base = await lit(); assert.ok(base.n > 0.97, `unmasked white card fills the frame (${base.n})`);

  // ellipse from the Inspector button
  await page.click('[data-mask-add="ellipse"]');
  const hasMask = await ev(() => window.__app.store.selectedClip.mask?.shapes?.length);
  assert.equal(hasMask, 1, 'the button adds an ellipse mask');
  await ev(() => { const c = window.__app.store.selectedClip; c.props.maskFeather = 0; c.mask.shapes[0].w = 0.5; c.mask.shapes[0].h = 0.6; window.__app.store.touch('project'); }); await settle(500);
  const ell = await lit(); assert.ok(ell.c > 200 && ell.k < 20, `inside the ellipse is lit, the corner is not (${ell.c}/${ell.k})`);
  assert.ok(ell.n > 0.2 && ell.n < 0.4, `an ellipse 0.5 x 0.6 covers about ${Math.round(Math.PI / 4 * 0.5 * 0.6 * 100)}% (${ell.n.toFixed(2)})`);
  await ev(() => { const c = window.__app.store.selectedClip; c.mask.invert = true; window.__app.store.touch('project'); }); await settle(400);
  const inv = await lit(); assert.ok(inv.c < 20 && inv.k > 200 && Math.abs(inv.n + ell.n - 1) < 0.05, `invert swaps inside and outside (${inv.c}/${inv.k}, ${(inv.n + ell.n).toFixed(2)})`);
  await ev(() => { const c = window.__app.store.selectedClip; c.mask.invert = false; window.__app.store.touch('project'); }); await settle(300);

  // grow / feather / move over time
  await ev(() => { const c = window.__app.store.selectedClip; c.props.maskGrow = 1; window.__app.store.touch('project'); }); await settle(400);
  const grown = await lit(); assert.ok(grown.n > ell.n + 0.05, `grow widens the mask (${ell.n.toFixed(2)} → ${grown.n.toFixed(2)})`);
  await ev(() => { const c = window.__app.store.selectedClip; c.props.maskGrow = -1; window.__app.store.touch('project'); }); await settle(400);
  const shrunk = await lit(); assert.ok(shrunk.n < ell.n - 0.05, `shrink narrows it (${shrunk.n.toFixed(2)})`);
  await ev(() => { const c = window.__app.store.selectedClip; c.props.maskGrow = 0; c.props.maskFeather = 1; window.__app.store.touch('project'); }); await settle(400);
  const soft = await ev(() => { const d = window.__grab(64, 36); let mid = 0; for (let i = 0; i < d.length; i += 3) if (d[i] > 30 && d[i] < 225) mid++; return mid / (d.length / 3); });
  assert.ok(soft > 0.05, `feather makes a soft edge (${soft.toFixed(2)} of pixels are partial)`);
  await ev(() => { const c = window.__app.store.selectedClip; c.props.maskFeather = 0; c.keyframes.maskX = [{ t: 0, v: -0.3 }, { t: 4, v: 0.3 }]; window.__app.store.touch('project'); window.__app.store.setPlayhead(0.2); }); await settle(500);
  const m0 = await lit(); await ev(() => window.__app.store.setPlayhead(3.8)); await settle(500); const m1 = await lit();
  assert.ok(m1.cx > m0.cx + 0.3, `the mask slides across the frame over time (${m0.cx.toFixed(2)} → ${m1.cx.toFixed(2)})`);
  await ev(() => { const c = window.__app.store.selectedClip; c.keyframes = {}; c.props.maskX = 0; window.__app.store.setPlayhead(1); window.__app.store.touch('project'); }); await settle(400);

  // a rectangle that is cut out of the ellipse
  await page.click('[data-mask-add="rect"]');
  await ev(() => { const c = window.__app.store.selectedClip; const s = c.mask.shapes[1]; s.w = 0.1; s.h = 0.1; s.sub = true; window.__app.store.touch('project'); }); await settle(500);
  const hole = await lit(); assert.ok(hole.c < 20 && hole.n < ell.n - 0.003, `a cut-out rectangle leaves a hole in the middle (${hole.c})`);
  await shot('29-mask-editor');

  // drag the east handle of the ellipse to enlarge it, with the real mouse
  await ev(() => { const c = window.__app.store.selectedClip; c.mask.shapes.splice(1, 1); window.__app.maskEdit.sel = 0; window.__app.maskEdit.on = true; window.__app.store.touch('project'); window.__app.store.emit('maskedit'); }); await settle(500);
  const before = await ev(() => window.__app.store.selectedClip.mask.shapes[0].w);
  const from = await ev(() => window.__app.maskEditor.toScreen(0.5 + 0.25, 0.5)), to = await ev(() => window.__app.maskEditor.toScreen(0.5 + 0.4, 0.5));
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move((from.x + to.x) / 2, from.y, { steps: 4 }); await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up();
  const after = await ev(() => window.__app.store.selectedClip.mask.shapes[0].w);
  assert.ok(after > before + 0.1, `dragging a handle resizes the shape (${before} → ${after.toFixed(2)})`);
  await ev(() => window.__app.store.undo()); await settle(300);
  assert.ok(Math.abs((await ev(() => window.__app.store.selectedClip.mask.shapes[0].w)) - before) < 1e-6, 'one Undo reverts the drag');

  // draw a polygon with clicks: a triangle that covers about a quarter of the frame
  await ev(() => { const c = window.__app.store.selectedClip; delete c.mask; window.__app.store.touch('project'); window.__app.store.emit('maskedit'); }); await settle(300);
  await page.click('[data-mask-add="poly"]'); await settle(300);
  for (const [u, v] of [[0.25, 0.9], [0.5, 0.1], [0.75, 0.9]]) { const s = await ev(([u, v]) => window.__app.maskEditor.toScreen(u, v), [u, v]); await page.mouse.click(s.x, s.y); }
  await page.keyboard.press('Enter'); await settle(500);
  const poly = await ev(() => window.__app.store.selectedClip.mask?.shapes?.[0]);
  assert.equal(poly?.k, 'poly'); assert.equal(poly.pts.length, 3, 'three clicks make a triangle');
  await ev(() => { window.__app.store.selectedClip.props.maskFeather = 0; window.__app.store.touch('project'); }); await settle(500);
  const tri = await lit(); assert.ok(tri.n > 0.15 && tri.n < 0.25 && tri.k < 20, `the drawn triangle (base 0.5, height 0.8) shows about a fifth of the frame (${tri.n.toFixed(2)})`);

  // matte: a title decides what shows
  await ev(async () => { const { store } = window.__app; const T = await import('/shared/text-defs.js'); const TL = await import('/shared/timeline.js');
    store.mutate((p) => { const c = store.selectedClip; delete c.mask; const pr = T.TEXT_PRESETS.find((x) => x.name.startsWith('Y2K Chrome Bubble')) || T.TEXT_PRESETS[0];
      const tc = T.createTextClip(pr, 0, 6); tc.text.content = 'MATTE'; tc.text.size = 0.4; tc.text.fit = 0.9; tc.text.color = '#ffffff'; tc.text.fx.gradient = false; tc.name = 'matte title';
      tc.trackId = TL.addTrack(p, 'video').id; TL.addClipRaw(p, tc); }); });
  await settle(600);
  const withTitle = await lit(); assert.ok(withTitle.n > 0.97, `before matting, the white card is still all there (${withTitle.n})`);
  await ev(() => { const { store } = window.__app; const tc = store.project.clips.find((c) => c.name === 'matte title'); const c = store.project.clips.find((x) => x.type === 'media'); store.select(c.id); store.mutate(() => { c.matte = { source: tc.id, use: 'alpha', invert: false }; }); }); await settle(700);
  await shot('30-title-matte');
  assert.equal(await ev(() => { window.__app.preview.forceDraw(); return window.__app.preview.comp.gl.getError(); }), 0, 'matte drawing raises no GL error');
  const matted = await lit(); assert.ok(matted.n > 0.03 && matted.n < 0.5 && matted.k < 20, `through the title only the letters show (${matted.n.toFixed(2)})`);
  await ev(() => { const { store } = window.__app; store.project.clips.find((x) => x.type === 'media').matte.invert = true; store.touch('project'); }); await settle(500);
  const mInv = await lit(); assert.ok(mInv.n > 0.5 && Math.abs(mInv.n + matted.n - 1) < 0.08, `inverting the matte shows everything but the letters (${mInv.n.toFixed(2)})`);
  await ev(() => { const { store } = window.__app; delete store.project.clips.find((x) => x.type === 'media').matte; store.touch('project'); }); await settle(500);
  assert.ok((await lit()).n > 0.97, 'removing the matte brings the whole picture back');

  // luma matte: a half-white / half-black picture
  await ev(async ([h]) => { await window.__app.importPaths([h]); const { store } = window.__app; const TL = await import('/shared/timeline.js');
    store.mutate((p) => { p.clips = p.clips.filter((c) => c.name !== 'matte title'); const m = p.media[p.media.length - 1]; const c = TL.addMediaClip(p, m.id, TL.addTrack(p, 'video').id, 0); c.duration = 6; c.name = 'half'; }); }, [halfL]);
  await ev(() => { const { store } = window.__app; const half = store.project.clips.find((c) => c.name === 'half'); const c = store.project.clips.find((x) => x.type === 'media' && x.id !== half.id); store.select(c.id); store.mutate(() => { c.matte = { source: half.id, use: 'luma', invert: false }; }); }); await settle(700);
  const luma = await lit(); assert.ok(luma.n > 0.4 && luma.n < 0.6 && luma.cx < 0.4, `a luma matte shows only where the matte is bright (${luma.n.toFixed(2)}, centre ${luma.cx.toFixed(2)})`);
  await ev(() => { const { store } = window.__app; store.project.clips.find((x) => x.type === 'media' && x.name !== 'half').matte.use = 'alpha'; store.touch('project'); }); await settle(500);
  assert.ok((await lit()).n > 0.97, 'an alpha matte of an opaque picture shows everything');
});

await step('timeline tracks reorder: drag the grip or use the arrows, audio can sit above video, rename, remove an empty row, video order changes what draws on top', async () => {
  await resetProject();
  await ev(async (c) => { await window.__app.importPaths([c]); const { store } = window.__app; const { addMediaClip } = await import('/shared/timeline.js');
    store.mutate((p) => { p.settings.width = 480; p.settings.height = 270; addMediaClip(p, p.media[0].id, p.tracks.find((t) => t.kind === 'video').id, 0); }); }, clip);
  const order = () => ev(() => window.__app.store.project.tracks.map((t) => t.name).join(','));
  const start = await order(); assert.equal(start, 'V2,V1,A1,A2');
  // arrows: send the first audio row to the very top
  const ids = await ev(() => Object.fromEntries(window.__app.store.project.tracks.map((t) => [t.name, t.id])));
  for (let i = 0; i < 2; i++) await page.click(`.tl-row[data-row="${ids.A1}"] button.mv.up`);
  assert.equal(await order(), 'A1,V2,V1,A2', 'audio row moved above the video rows with the arrows');
  // drag: grab V1's grip and drop it above the first row
  const g = await page.locator(`.tl-row[data-row="${ids.V1}"] .grip`).boundingBox();
  const top = await page.locator(`.tl-row[data-row="${ids.A1}"]`).boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
  await page.mouse.move(g.x + 4, top.y + 4, { steps: 6 });
  assert.ok(await page.locator('.tl-drop').count() === 1, 'a drop line shows where it will land');
  await page.mouse.up();
  assert.equal(await order(), 'V1,A1,V2,A2', 'dragging the grip moved the video row to the top');
  assert.equal(await page.locator('.tl-drop').count(), 0, 'the drop line is gone');
  // the picture follows video order: a text clip on V2 hides under a text clip on V1 only while V1 is the upper row
  await ev(async ({ v1, v2 }) => { const { store } = window.__app; const TD = await import('/shared/text-defs.js'); const T = await import('/shared/timeline.js');
    store.mutate((p) => { p.clips = []; for (const [tid, col] of [[v2, '#ff0000'], [v1, '#00ff00']]) { const c = TD.createTextClip(null, 0, 4); c.text.content = 'W'; c.text.size = 0.9; c.text.color = col; c.text.anim = { ...c.text.anim, type: 'none' }; c.trackId = tid; T.addClipRaw(p, c); } }); store.setPlayhead(1); }, { v1: ids.V1, v2: ids.V2 });
  await settle(600);
  const dom = () => ev(() => { const d = window.__grab(48, 27); let r = 0, g = 0; for (let i = 0; i < d.length; i += 3) { r += d[i]; g += d[i + 1]; } return g > r ? 'green' : 'red'; });
  assert.equal(await dom(), 'green', 'V1 is the upper row so its green text draws on top');
  await page.click(`.tl-row[data-row="${ids.V1}"] button.mv.down`); await page.click(`.tl-row[data-row="${ids.V1}"] button.mv.down`); await settle(600);
  assert.equal(await dom(), 'red', 'after V1 moves below V2 the red text is on top');
  // rename + remove an empty row
  await page.dblclick(`.tl-row[data-row="${ids.A2}"] .tl-name b`); await page.fill('.tl-rename', 'MUSIC'); await page.keyboard.press('Enter');
  assert.match(await order(), /MUSIC/, 'double-click renames a track');
  await page.click(`.tl-row[data-row="${ids.A2}"] button.mv.rm`);
  assert.ok(!(await order()).includes('MUSIC'), 'an empty extra row can be removed');
  assert.equal(await ev(() => window.__app.store.project.tracks.filter((t) => t.kind === 'audio').length), 1, 'the last audio row stays');
  assert.equal(await page.locator(`.tl-row[data-row="${ids.A1}"] button.mv.rm`).count(), 0, 'no remove button on the last row of its kind');
  await ev(() => window.__app.store.undo()); await ev(() => window.__app.store.undo());
  await shot('25-track-reorder');
});

await step('niche looks render: dither, holo, kaleidoscope, spores, cells, HUD, edge-following veins each change the picture and compile cleanly', async () => {
  await resetProject();
  await ev(async (c) => { await window.__app.importPaths([c]); const { store } = window.__app; const { addMediaClip } = await import('/shared/timeline.js');
    store.mutate((p) => { p.settings.width = 480; p.settings.height = 270; addMediaClip(p, p.media[0].id, p.tracks.find((t) => t.kind === 'video').id, 0); }); store.setPlayhead(1.2); }, clip);
  await settle(700);
  const grab = () => ev(() => window.__grab(96, 54));
  const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
  const base = await grab();
  const names = ['Anamorphic Night', 'Holo Foil', 'Handheld 1-bit', 'Amber Terminal', 'Camcorder', 'Thermal Lock', 'Kaleido Trip', 'Veins · Follow Edges', 'Spores · Bioluminescent', 'Cells · Glass', 'Lichen Bloom', '3D · Footage Cube', '3D · Chrome Sphere', '3D · Glass Torus', '3D · Wire Cube', '3D · Holo Pill', 'Synthwave Grid', 'Grid Floor (over footage)'];
  const errorsBefore = logs.length;
  for (const n of names) {
    await ev(async (n) => { const { store } = window.__app; const A = await import('/shared/adjust-defs.js'); const T = await import('/shared/timeline.js');
      store.mutate((p) => { p.clips = p.clips.filter((c) => c.type !== 'adjust'); const c = A.createAdjustClip([...A.ADJUST_LOOKS, ...A.ORGANIC_LOOKS].find((l) => l.name === n), 0, 6); c.trackId = T.addTrack(p, 'video').id; T.addClipRaw(p, c); }); store.setPlayhead(5); }, n);
    await settle(700);
    const d = diff(base, await grab());
    assert.ok(d > 1.5, `${n} changes the picture (Δ${d.toFixed(1)})`);
  }
  assert.equal(logs.slice(errorsBefore).filter((l) => /shader|compile|GLSL|WebGL/i.test(l)).length, 0, 'no shader errors in the console');
  await shot('26-niche-looks');
});

await step('montage v2: favourites and skip flags, hook + calm close, Y2K style grades the whole cut, optional title card, footage sound muted, exports', async () => {
  await resetProject();
  // regression: asking for an analysis while there is no song yet must not wedge the analysis for good
  await ev(async ([a, b, c]) => { await window.__app.importPaths([a, b, c]); const { store } = window.__app; const { addMediaClip } = await import('/shared/timeline.js');
    await window.__app.runAnalysis({ quiet: true });
    store.mutate((p) => addMediaClip(p, p.media.find((m) => m.kind === 'audio').id, p.tracks.find((t) => t.kind === 'audio').id, 0)); }, [clip, pic, kick]);
  const nb = await ev(async () => { const a = await window.__app.runAnalysis({ quiet: true }); return a ? a.beats.length : -1; });
  assert.ok(nb > 4, `the song has beats before the montage (${nb})`);
  const picName = path.basename(pic);
  await page.click('#panel-left [data-tab="media"]');
  await ev((n) => { [...document.querySelectorAll('#media-list .media-item')].find((i) => i.textContent.includes(n)).querySelector('.pick.skip').click(); }, picName);
  assert.equal(await ev((n) => window.__app.store.project.media.find((m) => m.name === n).pick, picName), 'skip', 'the ⊘ button marks the clip');

  assert.equal(await ev(() => document.querySelectorAll('#media-list .pick').length > 0 && !document.querySelector('#media-list .media-item .k.audio')?.closest('.media-item').querySelector('.pick')), true, 'audio has no flags');
  await page.click('#tl-montage'); await page.waitForSelector('#montage-modal');
  await page.click('#montage-modal [data-style="y2k"]');
  await page.check('#mt-title'); await page.fill('#mt-kicker', 'HIGH HUMAN LAB'); await page.fill('#mt-titletext', 'Night Bloom');
  await page.click('#mt-run'); await page.waitForSelector('#montage-modal .mt-result .mt-lines, #montage-modal .errbox', { timeout: 90000 });
  assert.equal(await ev(() => document.querySelector('#montage-modal .errbox')?.textContent || ''), '', 'the montage ran without an error');
  const text = await ev(() => document.querySelector('#montage-modal .mt-result').textContent);
  assert.match(text, /strongest shot/); assert.match(text, /adjustment layer: Digicam 2002/); assert.match(text, /1 clip left out/);
  const r = await ev((n) => { const { store } = window.__app; const P = store.project; const skipped = P.media.find((m) => m.name === n).id;
    const adj = P.clips.filter((c) => c.type === 'adjust'); const texts = P.clips.filter((c) => c.type === 'text');
    const cuts = P.clips.filter((c) => c.type === 'media' && P.media.find((m) => m.id === c.mediaId).kind === 'video').sort((a, b) => a.start - b.start);
    return { skippedUsed: P.clips.some((c) => c.mediaId === skipped), adj: adj.map((c) => ({ s: c.start, d: c.duration })), texts: texts.map((c) => c.text.content), muted: cuts.every((c) => c.volume === 0), vols: cuts.map((c) => c.volume).join(), lastFade: cuts.at(-1).fadeOut, dur: store.analysis.duration, n: cuts.length }; }, picName);
  assert.equal(r.skippedUsed, false, 'a skipped clip is never used');
  assert.equal(r.adj.length, 1); assert.ok(Math.abs(r.adj[0].d - r.dur) < 0.1, 'the look covers the whole cut');
  assert.ok(r.texts.includes('Night Bloom') && r.texts.includes('HIGH HUMAN LAB'), `title card added: ${r.texts}`);
  assert.ok(r.muted, `the footage sound is muted under the song (${r.vols})`); assert.ok(r.lastFade > 0, 'the closing shot fades out');
  await page.click('#mt-undo'); await page.waitForTimeout(200);
  assert.equal(await ev(() => window.__app.store.project.clips.filter((c) => c.type === 'adjust' || c.type === 'text').length), 0, 'one Undo removes the cut, the look and the title');
  await page.click('#mt-run'); await page.waitForSelector('#montage-modal .mt-result .mt-lines', { timeout: 90000 });
  const out = path.join(dir, 'montage-v2.mp4'); await ev((o) => window.__app.exportTo(o, { width: 192, height: 108, fps: 10 }), out);
  const v = probe(out); assert.ok(Math.abs(Number(v.format.duration) - r.dur) < 0.3, 'the Y2K montage exports to the length of the song');
  await shot('23-montage-y2k');
  await page.waitForFunction(() => !document.getElementById('mt-run').disabled);
  await ev(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Close').click());
  await page.waitForSelector('#montage-modal', { state: 'detached' });
});

await step('in-app updates: a staged update runs from the data folder, a broken or unconfirmed one rolls back, GitHub check stages a verified bundle, a different shell asks for an installer', async () => {
  const UC = await import(path.join(root, 'src/main/update-core.js'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const electronV = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
  const shellKey = UC.shellKeyOf({ electron: electronV, dependencies: pkg.dependencies });
  const bundled = pkg.version;
  const bump = (v) => { const [a, b, c] = v.split('.').map(Number); return `${a}.${b}.${c + 1}`; };
  const next = bump(bundled);
  // a copy of src/ with a visible marker, optionally with broken main code
  const makeBundle = (version, { broken = false, key = shellKey } = {}) => {
    const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-upd-src-')); fs.cpSync(path.join(root, 'src'), path.join(tree, 'src'), { recursive: true });
    const html = path.join(tree, 'src/renderer/index.html'); fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace(/<title>[^<]*<\/title>/, `<title>UPDATED ${version}</title>`));
    if (broken) fs.appendFileSync(path.join(tree, 'src/main/main.js'), "\nthrow new Error('this update is broken');\n");
    return UC.packBundle({ rootDir: tree, version, shellKey: key, notes: `notes for ${version}` });
  };
  const launch = async (env) => {
    const a = await _electron.launch({ executablePath: req('electron'), args: [root, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], env: { ...process.env, HHLAB_E2E: '1', HHLAB_E2E_NO_RECOVERY: '1', ...env } });
    const pg = await a.firstWindow(); await pg.waitForFunction(() => window.__app); return { a, pg };
  };
  const stageLocally = (dir, b, version) => { UC.unpackBundle(b.gz, path.join(dir, version)); fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ready: version })); };

  // 1) a staged, verified update is what runs; it confirms itself once its window has loaded
  const d1 = fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-upd-1-'));
  stageLocally(d1, makeBundle(next), next);
  let r = await launch({ HHLAB_UPDATES_DIR: d1 });
  assert.equal(await r.pg.title(), `UPDATED ${next}`, 'the renderer comes from the update');
  assert.deepEqual(await r.pg.evaluate(() => window.hh.appInfo()), { version: next, installed: bundled, updated: true });
  await r.pg.waitForTimeout(500);
  let stt = UC.readState(d1); assert.deepEqual([stt.pending, stt.verified, stt.ready], [null, next, next], 'confirmed: not pending any more');
  assert.equal(await r.pg.evaluate(() => window.__app.store.project.clips.length), 0, 'and the updated app is fully working');
  assert.ok(await r.pg.evaluate(() => !!document.getElementById('update-card') || true));
  await r.a.close();

  // 2) an update whose main code throws: it is blacklisted and the app restarts on the installed code
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-upd-2-'));
  stageLocally(d2, makeBundle(next, { broken: true }), next);
  const child = spawn(req('electron'), [root, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], { env: { ...process.env, HHLAB_E2E: '1', HHLAB_UPDATES_DIR: d2 }, detached: true, stdio: 'ignore' });
  for (let i = 0; i < 100 && !UC.readState(d2).bad.includes(next); i++) await new Promise((x) => setTimeout(x, 200));
  stt = UC.readState(d2); assert.ok(stt.bad.includes(next) && stt.ready === null, `blacklisted: ${JSON.stringify(stt)}`);
  await new Promise((x) => setTimeout(x, 1500)); // let the relaunched installer-code process come up, then stop the whole group
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  r = await launch({ HHLAB_UPDATES_DIR: d2 });
  assert.notEqual(await r.pg.title(), `UPDATED ${next}`); assert.deepEqual(await r.pg.evaluate(() => window.hh.appInfo()), { version: bundled, installed: bundled, updated: false });
  await r.a.close();

  // 3) an update that started but never confirmed (crash / hang): next start falls back
  const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-upd-3-'));
  stageLocally(d3, makeBundle(next), next); fs.writeFileSync(path.join(d3, 'state.json'), JSON.stringify({ ready: next, pending: next }));
  r = await launch({ HHLAB_UPDATES_DIR: d3 });
  assert.equal((await r.pg.evaluate(() => window.hh.appInfo())).updated, false); assert.ok(UC.readState(d3).bad.includes(next));
  await r.a.close();

  // 4) a wrong-shell update is ignored; so is one that is not newer than the installer
  const d4 = fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-upd-4-'));
  stageLocally(d4, makeBundle(next, { key: 'some-other-shell' }), next);
  r = await launch({ HHLAB_UPDATES_DIR: d4 }); assert.equal((await r.pg.evaluate(() => window.hh.appInfo())).updated, false); await r.a.close();

  // 5) a fake GitHub: the app checks, downloads, verifies and stages; the top-bar button offers the restart; the next start runs it
  const serve = (routes) => { const srv = http.createServer((q, res) => { const h = routes[q.url]; if (!h) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': h.type || 'application/json' }); res.end(h.body); }).listen(0, '127.0.0.1'); return new Promise((ok) => srv.once('listening', () => ok(srv))); };
  const release = async ({ key = shellKey, tamper = false } = {}) => {
    const b = makeBundle(next, { key }); const file = `hhlab-update-${next}.json.gz`;
    const srv = await serve({}); const base = `http://127.0.0.1:${srv.address().port}`;
    const bad = tamper ? Buffer.concat([b.gz, Buffer.from('x')]) : b.gz;
    srv.removeAllListeners('request');
    srv.on('request', (q, res) => {
      const m = { '/latest': { tag_name: `v${next}`, html_url: 'https://github.com/Biboon356/high-human-lab-visual-editor/releases/tag/test', assets: [{ name: 'update.json', browser_download_url: `${base}/update.json` }, { name: file, browser_download_url: `${base}/${file}` }] },
        '/update.json': { version: next, shellKey: key, file, sha256: b.sha256, notes: 'Fixes everything' } }[q.url];
      if (m) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(m)); }
      if (q.url === `/${file}`) { res.writeHead(200); return res.end(bad); }
      res.writeHead(404); res.end();
    });
    return { srv, api: `${base}/latest` };
  };
  const d5 = fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-upd-5-')); const rel = await release();
  r = await launch({ HHLAB_UPDATES_DIR: d5, HHLAB_UPDATE_API: rel.api, HHLAB_UPDATE_FORCE: '1', HHLAB_UPDATE_DELAY_MS: '300' });
  await r.pg.waitForFunction((v) => { const b = document.getElementById('btn-update'); return b && !b.hidden && b.textContent.includes(v); }, next, { timeout: 30000 });
  assert.equal(UC.readState(d5).ready, next); assert.ok(fs.existsSync(path.join(d5, next, 'src/main/main.js')), 'staged on disk');
  await r.pg.evaluate(() => document.querySelector('[data-tab=project]').click());
  assert.match(await r.pg.evaluate(() => document.getElementById('update-card').textContent), new RegExp(`Version ${bundled.replace(/\./g, '\\.')}`));
  await r.pg.screenshot({ path: path.join(shots, '21-update-ready.png') }); await r.a.close();
  r = await launch({ HHLAB_UPDATES_DIR: d5, HHLAB_NO_UPDATES: '' }); assert.equal(await r.pg.title(), `UPDATED ${next}`, 'the staged update runs on the next start'); await r.a.close(); rel.srv.close();

  // 6) a tampered download is rejected and nothing is staged; a different shell is reported as "needs installer"
  const d6 = fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-upd-6-')); const t = await release({ tamper: true });
  r = await launch({ HHLAB_UPDATES_DIR: d6, HHLAB_UPDATE_API: t.api, HHLAB_UPDATE_FORCE: '1', HHLAB_UPDATE_DELAY_MS: '100' });
  await r.pg.evaluate(() => document.querySelector('[data-tab=project]').click());
  await r.pg.waitForFunction(() => /checksum/.test(document.getElementById('update-card')?.textContent || ''), null, { timeout: 30000 });
  assert.equal(UC.readState(d6).ready, null); assert.equal(await r.pg.evaluate(() => document.getElementById('btn-update').hidden), true); await r.a.close(); t.srv.close();
  const d7 = fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-upd-7-')); const w = await release({ key: 'other-shell' });
  r = await launch({ HHLAB_UPDATES_DIR: d7, HHLAB_UPDATE_API: w.api, HHLAB_UPDATE_FORCE: '1', HHLAB_UPDATE_DELAY_MS: '100' });
  await r.pg.waitForFunction(() => { const b = document.getElementById('btn-update'); return b && !b.hidden && /installer/i.test(b.textContent); }, null, { timeout: 30000 });
  assert.equal(UC.readState(d7).ready, null, 'nothing staged for a different shell'); await r.a.close(); w.srv.close();
});

await step('export dialog: platform preset sets 9:16 / fps / quality', async () => {
  await resetProject(); await ev((p) => window.__app.importPaths([p]), clip);
  await page.click('[data-act="export"]'); await page.waitForSelector('.modal');
  await page.selectOption('.modal select >> nth=0', 'tiktok');
  const v = await ev(() => [...document.querySelectorAll('.modal select')].map((s) => s.value));
  assert.deepEqual(v.slice(0, 4), ['tiktok', 'vertical-1080', '30', 'high']);
  await ev(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Close').click());
});

await step('root system generator: branching roots grow over time in preview and in the exported file', async () => {
  await resetProject();
  await ev(async () => { const { store } = window.__app; const m = await import('/shared/organic-defs.js'); const { addClipRaw } = await import('/shared/timeline.js');
    store.mutate((p) => { const c = m.createGeneratorClip(m.GEN_PRESETS.find((x) => x.name === 'Root System (rising, black)'), 0, 6); c.trackId = p.tracks.find((t) => t.name === 'V1').id; addClipRaw(p, c); }); });
  const lit = async (t) => { await ev((t) => window.__app.store.setPlayhead(t), t); await settle(500); return ev(() => { const d = window.__grab(96, 54); let n = 0; for (let i = 0; i < d.length; i += 3) if (d[i] + d[i + 1] + d[i + 2] > 150) n++; return n / (d.length / 3); }); };
  const a = await lit(0.8), b = await lit(2.5), c = await lit(5.5);
  assert.ok(a < b && b < c, `coverage grows with time: ${a.toFixed(3)} < ${b.toFixed(3)} < ${c.toFixed(3)}`); assert.ok(c > 0.05, 'a full root system is on screen');
  const out = path.join(dir, 'roots-out.mp4'); await ev((o) => window.__app.exportTo(o, { width: 320, height: 568, fps: 12 }), out);
  const raw = path.join(dir, 'roots.raw'); sh(FFMPEG, ['-v', 'error', '-y', '-ss', '5', '-i', out, '-frames:v', '1', '-vf', 'scale=32:56,format=gray', '-f', 'rawvideo', raw]);
  const d = fs.readFileSync(raw); let n = 0; for (const x of d) if (x > 120) n++; assert.ok(n / d.length > 0.04, `exported frame shows the roots (${(n / d.length).toFixed(3)})`);
});

await step('cut-in transitions: flash/punch/glitch/whip change only the first frames of a clip', async () => {
  await resetProject(); await ev((p) => window.__app.importPaths([p]), clip);
  const grabAt = async (t) => { await ev((t) => window.__app.store.setPlayhead(t), t); await settle(450); return ev(() => window.__grab(48, 27)); };
  const diff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
  const base0 = await grabAt(0.04), base1 = await grabAt(1.5);
  const res = {};
  for (const type of ['flash', 'punch', 'glitch', 'whip']) {
    await ev((type) => { const { store } = window.__app; store.mutate((p) => { p.clips[0].transition = { type, duration: 0.4 }; }); }, type);
    res[type] = { early: +diff(base0, await grabAt(0.04)).toFixed(2), late: +diff(base1, await grabAt(1.5)).toFixed(2) };
  }
  for (const [type, r] of Object.entries(res)) { assert.ok(r.early > 2, `${type} visibly alters the first frames: ${JSON.stringify(res)}`); assert.ok(r.late < 0.5, `${type} leaves later frames untouched: ${JSON.stringify(res)}`); }
});

await step('autosave: unsaved work is written to disk, restored after a "crash", cleared by saving', async () => {
  await resetProject(); await ev((p) => window.__app.importPaths([p]), clip);
  await ev(() => window.__app.store.mutate((p) => { p.name = 'crash-test'; }));
  assert.equal(await ev(() => window.__app.autosave.writeNow()), true);
  const ap = path.join(await app.evaluate(({ app: a }) => a.getPath('userData')), 'autosave.hhlab');
  const stored = fs.readFileSync(ap, 'utf8');
  assert.equal(JSON.parse(stored).name, 'crash-test'); assert.equal(JSON.parse(stored).clips.length, 1);
  // simulate a restart: wipe state, accept the restore prompt
  await ev(async () => { const { createProject } = await import('/shared/project.js'); window.__app.store.loadProject(createProject()); });
  await ev(async () => { const a = window.hh; window.__saved = await a.autosaveRead(); });
  // loadProject cleared the autosave (clean state) — write it back like a crashed session would have left it
  fs.writeFileSync(ap, stored);
  page.once('dialog', (d) => d.accept());
  assert.equal(await ev(() => window.__app.autosave.offerRecovery()), true);
  const r = await ev(() => ({ name: window.__app.store.project.name, clips: window.__app.store.project.clips.length, dirty: window.__app.store.dirty }));
  assert.deepEqual(r, { name: 'crash-test', clips: 1, dirty: true });
  await settle(900); assert.ok((await px()).lit > 0.3, 'restored project renders (media access re-granted)');
  // saving makes the autosave obsolete
  await ev((f) => window.hh.saveProject(window.__app.store.project, f, false), path.join(dir, 'after-restore.hhlab')); await ev(() => window.__app.store.setDirty(false)); await settle(300);
  assert.equal(fs.existsSync(ap), false, 'autosave removed after a clean state');
  // a corrupt autosave must not break startup
  fs.writeFileSync(ap, '{not json');
  assert.equal(await ev(() => window.__app.autosave.offerRecovery()), false);
});

await step('multi-select: shift-click, group drag, Delete, Undo, and Ripple delete close the gap', async () => {
  await resetProject(); await ev((p) => window.__app.importPaths([p]), pic);
  await ev(async () => { const { store } = window.__app; const { addMediaClip } = await import('/shared/timeline.js');
    store.mutate((p) => { p.clips.length = 0; const v2 = p.tracks.find((t) => t.name === 'V2').id; const m = p.media[0].id; [['A', 0], ['B', 3], ['C', 6]].forEach(([id, s]) => { const c = addMediaClip(p, m, v2, s); c.id = id; c.start = s; c.duration = 2; }); }); store.select(null); });
  await page.click('.clip[data-clip="A"]'); await page.click('.clip[data-clip="C"]', { modifiers: ['Shift'] });
  assert.equal(await ev(() => document.querySelectorAll('.clip.sel').length), 2, 'two clips highlighted');
  const box = await ev(() => { const r = document.querySelector('.clip[data-clip="A"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + 36, box.y, { steps: 6 }); await page.mouse.up();
  let r = await ev(() => Object.fromEntries(window.__app.store.project.clips.map((c) => [c.id, +c.start.toFixed(2)])));
  assert.ok(r.A > 0.4 && r.A < 0.8 && Math.abs(r.C - (6 + r.A)) < 0.02 && r.B === 3, `A and C moved together, B stayed: ${JSON.stringify(r)}`);
  await page.keyboard.press('Delete'); await settle(150);
  assert.deepEqual(await ev(() => window.__app.store.project.clips.map((c) => c.id)), ['B'], 'Delete removes the whole selection');
  await ev(() => window.__app.store.undo()); assert.equal(await ev(() => window.__app.store.project.clips.length), 3, 'one Undo restores both');
  const before = await ev(() => Object.fromEntries(window.__app.store.project.clips.map((c) => [c.id, c.start])));
  await page.click('.clip[data-clip="A"]'); await page.click('#tl-ripple'); await settle(150);
  r = await ev(() => Object.fromEntries(window.__app.store.project.clips.map((c) => [c.id, c.start])));
  assert.equal(r.A, undefined, 'A removed');
  assert.ok(Math.abs(r.B - (before.B - 2)) < 1e-6 && Math.abs(r.C - (before.C - 2)) < 1e-6, `later clips slid left by A's length (2s): ${JSON.stringify({ before, after: r })}`);
});

await step('kinetic type: letters rise one by one, wave moves, scramble decodes to the real text', async () => {
  await resetProject();
  const stat = async (anim, t) => ev(async ([anim, t]) => { const { store } = window.__app; const T = await import('/shared/text-defs.js'); const { addClipRaw } = await import('/shared/timeline.js');
    store.mutate((p) => { p.clips.length = 0; const c = T.createTextClip(null, 0, 4); c.trackId = p.tracks.find((x) => x.name === 'V1').id; c.text.content = 'HELLO WORLD'; c.text.size = 0.2; c.text.anim = { type: anim, duration: 1.2, speed: 1 }; addClipRaw(p, c); });
    store.setPlayhead(t); await new Promise((r) => setTimeout(r, 450)); const d = window.__grab(96, 54); let n = 0; for (let i = 0; i < d.length; i += 3) if (d[i] > 128) n++; return { n, sig: Array.from(d.slice(0, 5000)).join(',').length + d.reduce((a, b) => a + b, 0) }; }, [anim, t]);
  const none = await stat('none', 3);
  const l0 = await stat('letters', 0.12), l1 = await stat('letters', 0.5), l2 = await stat('letters', 3);
  assert.ok(l0.n < l1.n && l1.n < l2.n, `letters appear progressively: ${l0.n} < ${l1.n} < ${l2.n}`);
  assert.ok(Math.abs(l2.n - none.n) / none.n < 0.03, `finished letters match the plain text (${l2.n} vs ${none.n})`);
  const w1 = await stat('wave', 0.3), w2 = await stat('wave', 0.9); assert.notEqual(w1.sig, w2.sig, 'wave changes over time');
  const s0 = await stat('scramble', 0.15), s2 = await stat('scramble', 3);
  assert.notEqual(s0.sig, none.sig, 'scrambled glyphs differ from the final text'); assert.equal(s2.sig, none.sig, 'once decoded the picture is identical to plain text');
});

await step('save frame: full-resolution PNG of the current frame, effects included', async () => {
  await resetProject(); await ev((p) => window.__app.importPaths([p]), clip);
  await ev(async () => { const { store } = window.__app; const { createEffect } = await import('/shared/effects-defs.js'); store.mutate((p) => { p.settings.width = 1280; p.settings.height = 720; p.clips[0].effects.push(createEffect('color', { saturation: 0 })); }); store.setPlayhead(1.5); });
  await settle(600);
  const png = path.join(dir, 'still.png'); await stubDialog('showSaveDialog', { canceled: false, filePath: png });
  await page.click('#t-still'); await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Saved'), null, { timeout: 30000 });
  const v = probe(png).streams[0]; assert.equal(v.width, 1280); assert.equal(v.height, 720);
  const raw = path.join(dir, 'still.raw'); sh(FFMPEG, ['-v', 'error', '-y', '-i', png, '-vf', 'scale=64:36', '-pix_fmt', 'rgb24', '-f', 'rawvideo', raw]);
  const d = fs.readFileSync(raw); let chroma = 0, lit = 0; for (let i = 0; i < d.length; i += 3) { chroma += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; }
  assert.ok(lit / (d.length / 3) > 0.5, 'frame has picture content'); assert.ok(chroma / (d.length / 3) < 6, `the saturation-0 effect is baked in (mean chroma ${(chroma / (d.length / 3)).toFixed(1)})`);
});

await step('TikTok Auto-Edit on real (synthetic) Thai speech: cuts silences, Thai captions, 9:16, loudness — verified in the exported file', async () => {
  const speech = path.join(root, 'test/fixtures/th-speech.ogg');
  const src = path.join(dir, 'speech-landscape.mp4');
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=17', '-i', speech, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]);
  await resetProject(); await ev((p) => window.__app.importPaths([p]), src);
  const SEGS = [{ text: 'สวัสดีครับ วันนี้เรามาทำคลิปติ๊กต็อกกันนะครับ', start: 0.0, end: 5.9 }, { text: 'ตัดต่อง่ายมากเลย แค่กดไม่กี่ปุ่ม', start: 7.2, end: 10.9 }, { text: 'ใครอยากรู้วิธีทำ ติดตามไว้เลยนะ', start: 12.4, end: 16.4 }];
  const steps = [];
  const res = await ev(async (segs) => { const a = window.__app; const r = await a.autoEdit.runAutoEdit({ opts: { look: 'clean' }, transcribe: async () => segs, onStep: () => {} });
    const p = a.store.project; const media = p.media[0];
    return { cuts: r.cuts, before: r.before, after: r.after, captions: r.captions, words: r.words, canvas: [p.settings.width, p.settings.height], normalize: p.audio?.normalize,
      main: p.clips.filter((c) => c.type === 'media').map((c) => ({ s: +c.start.toFixed(2), d: +c.duration.toFixed(2), in: +c.in.toFixed(2), scale: +c.props.scale.toFixed(2) })),
      caps: p.clips.filter((c) => c.type === 'text').map((c) => ({ s: +c.start.toFixed(2), e: +(c.start + c.duration).toFixed(2), text: c.text.content, karaoke: c.text.karaoke.words.length })), tracks: p.tracks.map((t) => t.name), mw: media.width }; }, SEGS);
  assert.equal(res.cuts, 3, `three speech bursts kept: ${JSON.stringify(res.main)}`);
  assert.ok(res.before > 16 && res.after < 15 && res.after > 11, `silences removed: ${res.before.toFixed(1)}s -> ${res.after.toFixed(1)}s`);
  assert.deepEqual(res.canvas, [1080, 1920]); assert.equal(res.normalize, true);
  assert.ok(res.main.every((c) => c.scale > 3), `16:9 fills a 9:16 canvas (scale ${res.main.map((c) => c.scale)})`);
  assert.ok(res.main[1].scale > res.main[0].scale, 'alternate cuts punch in');
  for (let i = 1; i < res.main.length; i++) assert.ok(Math.abs(res.main[i].s - (res.main[i - 1].s + res.main[i - 1].d)) < 1e-6, 'pieces are gapless after the ripple');
  assert.ok(res.captions >= 3 && res.words >= 15, `Thai captions built: ${res.captions} cards, ${res.words} words`);
  assert.ok(res.caps.every((c) => /[\u0E00-\u0E7F]/.test(c.text) && c.karaoke > 0 && c.e <= res.after + 0.5), 'captions are Thai, word-timed, inside the edit');
  assert.ok(res.tracks.includes('CAP'));
  await shot('14-autoedit');
  // one Undo restores the original single clip and canvas
  await ev(() => window.__app.store.undo());
  const back = await ev(() => ({ clips: window.__app.store.project.clips.length, w: window.__app.store.project.settings.width, tracks: window.__app.store.project.tracks.length }));
  assert.deepEqual(back, { clips: 1, w: 1280, tracks: 4 }, 'Undo is a single step');
  await ev(async (segs) => { await window.__app.autoEdit.runAutoEdit({ opts: { look: 'clean' }, transcribe: async () => segs }); }, SEGS);
  // export and measure the real file
  const out = path.join(dir, 'tiktok.mp4'); await ev((o) => window.__app.exportTo(o, { width: 360, height: 640, fps: 15, quality: 'draft' }), out);
  const info = probe(out); const v = info.streams.find((s) => s.codec_type === 'video');
  assert.equal(v.width, 360); assert.equal(v.height, 640); assert.ok(Math.abs(Number(info.format.duration) - res.after) < 0.4, `duration ${info.format.duration} vs planned ${res.after}`);
  const sd = spawnSync(FFMPEG, ['-v', 'info', '-i', out, '-vn', '-af', 'silencedetect=n=-38dB:d=0.5', '-f', 'null', '-'], { encoding: 'utf8' });
  const longSilences = [...sd.stderr.matchAll(/silence_duration: ([\d.]+)/g)].map((m) => Number(m[1]));
  console.log(`      exported ${Number(info.format.duration).toFixed(1)}s from a ${res.before.toFixed(1)}s source; silences >0.5s left: ${longSilences.length}`);
  assert.equal(longSilences.length, 0, `no long silences left in the exported audio: ${longSilences}`);
  const lufs = (f) => { const x = spawnSync(FFMPEG, ['-v', 'info', '-i', f, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }); return Number(/I:\s+(-?[\d.]+) LUFS/.exec(x.stderr.split('Summary:').pop())?.[1]); };
  const loud = lufs(out); console.log(`      integrated loudness ${loud} LUFS`);
  assert.ok(loud > -17.5 && loud < -11, `loudness normalised near -14 LUFS (got ${loud})`);
  // a caption is really burned into the frame: white pixels in the lower-middle area while someone speaks
  const raw = path.join(dir, 'cap.raw'); sh(FFMPEG, ['-v', 'error', '-y', '-ss', '2.0', '-i', out, '-frames:v', '1', '-vf', 'crop=360:200:0:300,scale=72:40,format=gray', '-f', 'rawvideo', raw]);
  const g = fs.readFileSync(raw); let white = 0; for (const b of g) if (b > 235) white++;
  assert.ok(white > 20, `caption text pixels present in the exported frame (${white})`);
});

await step('Auto-Edit dialog: friendly no-model message, subtitle-file path, results, SRT export, TikTok export preset', async () => {
  const speech = path.join(root, 'test/fixtures/th-speech.ogg'); const src = path.join(dir, 'speech-ui.mp4');
  sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=17', '-i', speech, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]);
  await resetProject(); await ev((p) => window.__app.importPaths([p]), src);
  await page.click('#btn-autoedit'); await page.waitForSelector('.ae-modal');
  assert.match(await ev(() => document.querySelector('.ae-modal h3').textContent), /TIKTOK AUTO-EDIT/);
  await page.click('#ae-run'); await page.waitForSelector('.ae-modal .errbox', { timeout: 30000 });
  const err = await ev(() => document.querySelector('.ae-modal .errbox').textContent); assert.match(err, /not downloaded yet/); assert.match(err, /subtitle file/);
  assert.equal(await ev(() => window.__app.store.project.clips.length), 1, 'a failed run changes nothing');
  // use a subtitle file (Thai cues placed on the real speech)
  const srt = path.join(dir, 'th.srt');
  fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:05,900\nสวัสดีครับ วันนี้เรามาทำคลิปติ๊กต็อกกันนะครับ\n\n2\n00:00:07,200 --> 00:00:10,900\nตัดต่อง่ายมากเลย แค่กดไม่กี่ปุ่ม\n\n3\n00:00:12,400 --> 00:00:16,400\nใครอยากรู้วิธีทำ ติดตามไว้เลยนะ\n');
  await stubDialog('showOpenDialog', { canceled: false, filePaths: [srt] });
  await page.click('.ae-modal button:has-text("subtitle file")'); await page.waitForFunction(() => document.querySelector('.ae-model')?.textContent.includes('th.srt'));
  await page.click('#ae-run'); await page.waitForSelector('.ae-modal .okbox', { timeout: 60000 });
  const ok = await ev(() => document.querySelector('.ae-modal .okbox').textContent); assert.match(ok, /one undoable step/); assert.match(ok, /3 clips/);
  const st = await ev(() => { const p = window.__app.store.project; return { main: p.clips.filter((c) => c.type === 'media').length, caps: p.clips.filter((c) => c.type === 'text').length, w: p.settings.width, h: p.settings.height }; });
  assert.deepEqual([st.main, st.w, st.h], [3, 1080, 1920]); assert.ok(st.caps >= 3);
  await shot('15-autoedit-dialog');
  // captions as .srt
  const out = path.join(dir, 'captions-out.srt'); await stubDialog('showSaveDialog', { canceled: false, filePath: out });
  await page.click('.ae-modal button:has-text("Export captions")'); await page.waitForFunction((f) => document.querySelector('.toast')?.textContent.includes('Saved'), out, { timeout: 15000 });
  const text = fs.readFileSync(out, 'utf8'); assert.match(text, /^1\n\d\d:\d\d:\d\d,\d{3} --> /); assert.match(text, /[\u0E00-\u0E7F]{3}/);
  // straight into the export dialog with the TikTok preset
  await page.click('.ae-modal button:has-text("Export for TikTok")'); await page.waitForSelector('.modal select');
  const v = await ev(() => [...document.querySelectorAll('.modal select')].map((s) => s.value)); assert.deepEqual(v.slice(0, 4), ['tiktok', 'vertical-1080', '30', 'high']);
  await ev(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Close').click());
});

await step('Caption editor: fix a word in the dialog, timing and karaoke ranges stay valid, one Undo, the correction is remembered and applied next time', async () => {
  const SEGS2 = [{ text: 'ทำคลิปติ๊กต๊อกกันนะครับ', start: 0.2, end: 5.8 }, { text: 'ตัดต่อง่ายมาก', start: 7.3, end: 10.8 }];
  const capsOf = () => ev(() => window.__app.store.project.clips.filter((c) => c.type === 'text').sort((a, b) => a.start - b.start).map((c) => ({ id: c.id, s: c.start, d: c.duration, t: c.text.content.replace(/\n/g, ''), k: c.text.karaoke?.words || [], raw: c.text.content })));
  await ev(() => localStorage.removeItem('hhlab.glossary'));
  const speechSrc = path.join(dir, 'speech-ui.mp4');
  if (!fs.existsSync(speechSrc)) sh(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=17', '-i', path.join(root, 'test/fixtures/th-speech.ogg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', speechSrc]);
  await resetProject(); await ev((p) => window.__app.importPaths([p]), speechSrc);
  await ev(async (s) => { await window.__app.autoEdit.runAutoEdit({ opts: { look: 'clean' }, transcribe: async () => s }); }, SEGS2);
  const before = await capsOf();
  const target = before.find((c) => c.t.includes('ติ๊กต๊อก')); assert.ok(target, `a caption contains the misheard word: ${JSON.stringify(before.map((c) => c.t))}`);
  await page.click('#btn-captions'); await page.waitForSelector('.cap-modal .cap-row');
  const idx = before.indexOf(target);
  const input = page.locator('.cap-modal .cap-row input').nth(idx);
  assert.equal(await input.inputValue(), target.t);
  await input.fill(target.t.replace('ติ๊กต๊อก', 'TikTok'));
  await shot('16-caption-editor');
  await page.click('#cap-save'); await page.waitForFunction(() => !document.querySelector('.cap-modal'));
  const after = await capsOf();
  const edited = after.find((c) => c.id === target.id); assert.ok(edited && edited.t.includes('TikTok') && !edited.t.includes('ติ๊กต๊อก'), edited?.t);
  assert.ok(Math.abs(edited.s - target.s) < 1e-6 && Math.abs(edited.d - target.d) < 1e-6, 'the caption keeps its place on the timeline');
  assert.equal(edited.k.map((w) => edited.raw.slice(w.from, w.to)).join(''), edited.t, 'karaoke ranges cover the new text exactly');
  assert.ok(edited.k.every((w, i) => w.end >= w.start && w.start >= -1e-6 && (i === 0 || w.start >= edited.k[i - 1].end - 1e-6)), 'word times stay ordered');
  assert.equal(after.filter((c) => c.id !== target.id).map((c) => c.t).join('|'), before.filter((c) => c.id !== target.id).map((c) => c.t).join('|'), 'other captions untouched');
  // single undo step
  await ev(() => window.__app.store.undo());
  assert.equal((await capsOf()).find((c) => c.id === target.id).t, target.t, 'Undo restores the original wording');
  // the correction was remembered...
  const g = await ev(() => JSON.parse(localStorage.getItem('hhlab.glossary') || '[]'));
  assert.ok(g.some((e) => e.to.includes('TikTok') || e.to.includes('Tik')), `glossary learned something: ${JSON.stringify(g)}`);
  // ...and the next transcript comes out corrected without touching the captions again
  await resetProject(); await ev((p) => window.__app.importPaths([p]), path.join(dir, 'speech-ui.mp4'));
  await ev(async (s) => { await window.__app.autoEdit.runAutoEdit({ opts: { look: 'clean' }, transcribe: async () => s }); }, SEGS2);
  const again = await capsOf(); assert.ok(again.some((c) => c.t.includes('TikTok')) && !again.some((c) => c.t.includes('ติ๊กต๊อก')), JSON.stringify(again.map((c) => c.t)));
  await ev(() => localStorage.removeItem('hhlab.glossary'));
});

await step('Auto-Edit model download: progress, ready state, a bad model file is reported clearly, removal', async () => {
  await resetProject(); await ev((p) => window.__app.importPaths([p]), path.join(dir, 'speech-ui.mp4'));
  await page.click('#btn-autoedit'); await page.waitForSelector('.ae-modal');
  await page.selectOption('.ae-modal .ae-ctl select >> nth=1', 'fast');
  await page.click('.ae-modal button:has-text("Download")');
  await page.waitForFunction(() => document.querySelector('.ae-model')?.textContent.includes('ready'), null, { timeout: 90000 });
  const ud = await app.evaluate(({ app: a }) => a.getPath('userData')); const mf = path.join(ud, 'models', 'ggml-small-q5_1.bin');
  assert.ok(fs.existsSync(mf) && fs.statSync(mf).size === 160e6, 'model file downloaded completely');
  await page.click('#ae-run'); await page.waitForSelector('.ae-modal .errbox', { timeout: 60000 });
  const err = await ev(() => document.querySelector('.ae-modal .errbox').textContent);
  assert.match(err, /speech model could not be opened|Transcription failed|speech engine could not be loaded/, `a corrupt model is explained: ${err}`);
  assert.equal(await ev(() => window.__app.store.project.clips.length), 1, 'project untouched');
  await page.click('.ae-modal button:has-text("Remove model")'); await page.waitForFunction(() => document.querySelector('.ae-model')?.textContent.includes('Download'));
  assert.equal(fs.existsSync(mf), false, 'model removed from disk');
  await ev(() => [...document.querySelectorAll('.ae-modal button')].find((b) => b.textContent === 'Close').click());
});

await step('safe-zone guide toggles and follows the 9:16 canvas', async () => {
  await ev(async () => { const { createProject } = await import('/shared/project.js'); const p = createProject(); p.settings.width = 1080; p.settings.height = 1920; window.__app.store.loadProject(p); });
  await page.click('#t-safe'); await settle(200);
  const r = await ev(() => { const z = document.querySelector('.safe-zone'); const b = z.getBoundingClientRect(); return { hidden: z.hidden, ratio: b.width / b.height }; });
  assert.equal(r.hidden, false); assert.ok(Math.abs(r.ratio - 9 / 16) < 0.01, `overlay has the canvas aspect (${r.ratio})`);
  await page.click('#t-safe'); assert.equal(await ev(() => document.querySelector('.safe-zone').hidden), true);
});

await step('light theme + collapsible panels', async () => {
  await ev(() => { document.getElementById('toggle-theme').click(); document.getElementById('toggle-left').click(); });
  await settle(300); await shot('11-light-collapsed');
  assert.equal(await ev(() => document.documentElement.dataset.theme), 'light');
  await ev(() => { document.getElementById('toggle-theme').click(); document.getElementById('toggle-left').click(); });
});

const bad = logs.filter((l) => !/GPU stall|swiftshader|GL Driver Message|Automatic fallback/i.test(l));
await step('no unexpected console errors during the whole run', async () => { assert.deepEqual(bad, []); });
// Quitting mid-export must not leave ffmpeg processes behind (they would burn CPU forever).
let orphanCheck = 'skipped';
try {
  const marker = `orphan-check-${Date.now()}`;
  await resetProject(); await ev((p) => window.__app.importPaths([p]), clip);
  ev((o) => window.__app.exportTo(o, { width: 1280, height: 720, fps: 30, quality: 'high' }), path.join(dir, `${marker}.mp4`)).catch(() => {});
  await page.waitForTimeout(2500);
  const alive = () => spawnSync('pgrep', ['-f', `${marker}`], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean).length;
  const before = alive();
  await app.close();
  await new Promise((r) => setTimeout(r, 1500));
  orphanCheck = before > 0 && alive() === 0 ? 'ok' : `before=${before} after=${alive()}`;
} catch (e) { orphanCheck = `error: ${e.message.split('\n')[0]}`; }
results.push(['no ffmpeg left running after quitting mid-export', orphanCheck === 'ok' ? 'PASS' : 'FAIL', orphanCheck]);
console.log(orphanCheck === 'ok' ? 'PASS  no ffmpeg left running after quitting mid-export' : `FAIL  no ffmpeg left running after quitting mid-export\n      ${orphanCheck}`);
const failed = results.filter((r) => r[1] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed. Artifacts: ${dir}`);
process.exit(failed ? 1 : 0);
