// End-to-end test: launches the real Electron app (under Xvfb + software GL on headless Linux),
// imports real media, edits, saves/reopens, exports, and verifies the output with ffprobe.
// Usage: xvfb-run -a node scripts/e2e.mjs     (on a desktop with a display: node scripts/e2e.mjs)
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
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
  try { await fn(); results.push([name, 'PASS', Date.now() - t0]); console.log(`PASS  ${name} (${Date.now() - t0}ms)`); }
  catch (e) { results.push([name, 'FAIL', e.message]); console.log(`FAIL  ${name}\n      ${e.message.split('\n').join('\n      ')}`); }
};

const app = await _electron.launch({
  executablePath: req('electron'),
  args: [root, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  env: { ...process.env, HHLAB_E2E: '1' },
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
    const t = createTextClip(TEXT_PRESETS[2], 0.2, 2.5); t.trackId = top;
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

await step('light theme + collapsible panels', async () => {
  await ev(() => { document.getElementById('toggle-theme').click(); document.getElementById('toggle-left').click(); });
  await settle(300); await shot('11-light-collapsed');
  assert.equal(await ev(() => document.documentElement.dataset.theme), 'light');
  await ev(() => { document.getElementById('toggle-theme').click(); document.getElementById('toggle-left').click(); });
});

const bad = logs.filter((l) => !/GPU stall|swiftshader|GL Driver Message|Automatic fallback/i.test(l));
await step('no unexpected console errors during the whole run', async () => { assert.deepEqual(bad, []); });
await app.close();
const failed = results.filter((r) => r[1] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed. Artifacts: ${dir}`);
process.exit(failed ? 1 : 0);
