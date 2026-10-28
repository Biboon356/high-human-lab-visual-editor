import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, uid, validateProject, createClip } from '../src/shared/project.js';
import { moveClips, deleteClips, setSpeed, addMediaClip, moveClip, trimStart, trimEnd, splitClip, deleteClip, activeVisualClips, projectDuration, addClipRaw, overlaps } from '../src/shared/timeline.js';
import { evalTrack, setKey, removeKey } from '../src/shared/keyframes.js';
import { transitionAt, resolveParam } from '../src/shared/params.js';
import { analyze, sampleFeatures } from '../src/shared/audio-analysis.js';
import { tempoChain, fadeFilters, buildExportArgs, buildAudioGraph, validateExportSettings, buildAnalysisArgs } from '../src/shared/export-plan.js';
import { buildRoots } from '../src/shared/roots.js';
import { planMontage } from '../src/shared/montage.js';
import { createEffect, EFFECT_PRESETS, instantiatePreset, EFFECTS } from '../src/shared/effects-defs.js';
import { createTextClip, TEXT_PRESETS } from '../src/shared/text-defs.js';
import { createGeneratorClip, GEN_PRESETS } from '../src/shared/organic-defs.js';

function fixture() {
  const p = createProject('t');
  p.media.push({ id: 'v', kind: 'video', name: 'v.mp4', path: '/tmp/v.mp4', duration: 10, hasAudio: true, width: 1920, height: 1080 });
  p.media.push({ id: 'a', kind: 'audio', name: 'a.wav', path: '/tmp/a.wav', duration: 20, hasAudio: true });
  p.media.push({ id: 'i', kind: 'image', name: 'i.png', path: '/tmp/i.png', duration: 0, hasAudio: false });
  return p;
}
const vTrack = (p) => p.tracks.find((t) => t.kind === 'video' && t.name === 'V1').id;
const aTrack = (p) => p.tracks.find((t) => t.kind === 'audio').id;

test('addMediaClip respects track kind and avoids overlap', () => {
  const p = fixture();
  assert.ok(addMediaClip(p, 'v', vTrack(p), 0));
  assert.equal(addMediaClip(p, 'a', vTrack(p), 0), null, 'audio on video track rejected');
  assert.equal(addMediaClip(p, 'v', aTrack(p), 0), null, 'video on audio track rejected');
  const second = addMediaClip(p, 'v', vTrack(p), 3);
  assert.equal(second.start, 10, 'overlapping drop is appended after existing clip');
  assert.equal(addMediaClip(p, 'i', vTrack(p), 0).duration, 5);
});

test('moveClip rejects overlaps and wrong tracks', () => {
  const p = fixture();
  const a = addMediaClip(p, 'v', vTrack(p), 0);
  const b = addMediaClip(p, 'i', vTrack(p), 10);
  assert.equal(moveClip(p, b.id, 5), false);
  assert.equal(b.start, 10);
  assert.equal(moveClip(p, b.id, 12), true);
  assert.equal(moveClip(p, a.id, 0, aTrack(p)), false);
  assert.equal(moveClip(p, a.id, -4), true);
  assert.equal(a.start, 0, 'clamped to 0');
});

test('trim keeps content anchored and honours source length', () => {
  const p = fixture();
  const c = addMediaClip(p, 'v', vTrack(p), 2);
  trimStart(p, c.id, 4);
  assert.equal(c.start, 4); assert.equal(c.in, 2); assert.equal(c.duration, 8);
  trimEnd(p, c.id, 100);
  assert.ok(c.in + c.duration <= 10 + 1e-9, 'cannot extend past source end');
  trimEnd(p, c.id, 4.01);
  assert.ok(c.duration >= 0.1);
});

test('split partitions clip, in-points and keyframes', () => {
  const p = fixture();
  const c = addMediaClip(p, 'v', vTrack(p), 0);
  c.keyframes.opacity = [{ t: 1, v: 0 }, { t: 9, v: 1 }];
  c.effects.push(createEffect('blur'));
  c.effects[0].keyframes.radius = [{ t: 2, v: 5 }, { t: 8, v: 20 }];
  const r = splitClip(p, c.id, 4);
  assert.equal(c.duration, 4); assert.equal(r.start, 4); assert.equal(r.in, 4); assert.equal(r.duration, 6);
  assert.deepEqual(c.keyframes.opacity.map((k) => k.t), [1]);
  assert.deepEqual(r.keyframes.opacity.map((k) => k.t), [5]);
  assert.deepEqual(r.effects[0].keyframes.radius.map((k) => k.t), [4]);
  assert.notEqual(r.effects[0].id, undefined);
  assert.equal(splitClip(p, c.id, 0.05), null, 'too close to the edge');
  assert.equal(p.clips.length, 2);
});

test('delete + duration + active clips ordering', () => {
  const p = fixture();
  const top = p.tracks.find((t) => t.name === 'V2').id;
  const a = addMediaClip(p, 'v', vTrack(p), 0);
  const b = addClipRaw(p, createClip({ trackId: top, type: 'text', start: 1, duration: 2, text: {} }));
  assert.deepEqual(activeVisualClips(p, 1.5).map((c) => c.id), [a.id, b.id], 'lower track drawn first');
  assert.equal(projectDuration(p), 10);
  assert.ok(deleteClip(p, a.id)); assert.equal(projectDuration(p), 3);
  assert.equal(overlaps(p, top, 0, 5), true);
});

test('keyframes interpolate, clamp and edit', () => {
  let k = setKey([], 0, 0); k = setKey(k, 2, 10); k = setKey(k, 1, 5);
  assert.deepEqual(k.map((x) => x.t), [0, 1, 2]);
  assert.equal(evalTrack(k, -1, 99), 0); assert.equal(evalTrack(k, 5, 99), 10); assert.equal(evalTrack(k, 1, 99), 5);
  assert.equal(evalTrack([], 1, 7), 7);
  assert.equal(setKey(k, 1.01, 8).length, 3, 'near-time key replaces');
  assert.equal(removeKey(k, 1).length, 2);
});

test('resolveParam applies keyframes, bindings and clamps', () => {
  const o = { keyframes: { a: [{ t: 0, v: 0 }, { t: 1, v: 1 }] }, bindings: { a: { source: 'bass', amount: 0.5 } } };
  assert.equal(resolveParam(o, 'a', 0, 0, { bass: 1 }, [0, 10]), 5);
  assert.equal(resolveParam(o, 'a', 0, 1, { bass: 1 }, [0, 1.5]), 1.5, 'clamped');
  assert.equal(resolveParam(o, 'a', 0, 1, null, [0, 3]), 1, 'no analysis → base value');
});

test('audio analysis finds a click track tempo and band energy', () => {
  const sr = 22050, secs = 8, pcm = new Float32Array(sr * secs);
  const bpm = 120, step = Math.round(sr * 60 / bpm);
  for (let s = 0; s < pcm.length; s += step) for (let i = 0; i < 2000 && s + i < pcm.length; i++) pcm[s + i] = Math.sin(2 * Math.PI * 80 * i / sr) * Math.exp(-i / 500);
  const a = analyze(pcm, sr, 60);
  assert.ok(a.beats.length >= 12, `beats found: ${a.beats.length}`);
  assert.ok(Math.abs(a.bpm - 120) < 6, `bpm ${a.bpm}`);
  const f = sampleFeatures(a, a.beats[2] + 0.01);
  assert.ok(f.bass > f.high, 'low-frequency clicks register in the bass band');
  assert.ok(f.beat > 0.5);
  assert.equal(sampleFeatures(null, 1), null);
  const silent = analyze(new Float32Array(sr), sr);
  assert.equal(silent.beats.length, 0);
});

test('export args: raw video in, audio mix graph, codecs', () => {
  const p = fixture();
  const v = addMediaClip(p, 'v', vTrack(p), 0);
  const au = addMediaClip(p, 'a', aTrack(p), 2); au.in = 1; au.duration = 4; au.volume = 0.5;
  const s = { width: 1280, height: 720, fps: 30, quality: 'standard', format: 'mp4', outPath: '/tmp/o.mp4', duration: 10 };
  const args = buildExportArgs(p, s);
  const j = args.join(' ');
  assert.ok(j.includes('-f rawvideo -pix_fmt rgba -s 1280x720'));
  assert.ok(j.includes('-i /tmp/v.mp4') && j.includes('-i /tmp/a.wav'));
  assert.ok(j.includes('adelay=2000|2000') && j.includes('atrim=start=1.0000:end=5.0000') && j.includes('volume=0.500'));
  assert.ok(j.includes('libx264') && j.includes('aac') && args.at(-1) === '/tmp/o.mp4');
  assert.ok(j.includes('vflip'), 'GL frames are bottom-up');
  p.tracks.find((t) => t.kind === 'audio').muted = true; v.volume = 1;
  assert.equal(buildAudioGraph(p).inputs.length, 1, 'muted track excluded');
  assert.ok(buildExportArgs(p, { ...s, format: 'webm' }).includes('libvpx-vp9'));
  p.tracks.forEach((t) => (t.muted = true));
  const none = buildExportArgs(p, s);
  assert.ok(!none.includes('aac') && buildAnalysisArgs(p) === null);
  assert.deepEqual(validateExportSettings(s), []);
  assert.ok(validateExportSettings({ ...s, fps: 0, outPath: '' }).length >= 2);
});

test('validateProject rejects bad files and fills defaults', () => {
  assert.throws(() => validateProject(null));
  assert.throws(() => validateProject({ version: 99, media: [], tracks: [], clips: [], settings: {} }), /newer/);
  const p = fixture(); const c = addMediaClip(p, 'v', vTrack(p), 0); delete c.props; delete c.effects;
  const back = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(back.clips[0].props.opacity, 1); assert.deepEqual(back.clips[0].effects, []);
  p.clips[0].trackId = 'nope';
  assert.throws(() => validateProject(JSON.parse(JSON.stringify(p))), /missing track/);
});

test('presets and registries are internally consistent', () => {
  for (const pr of EFFECT_PRESETS) for (const fx of instantiatePreset(pr)) {
    assert.ok(EFFECTS[fx.type]);
    for (const k of Object.keys(fx.params)) assert.ok(EFFECTS[fx.type].params.some((d) => d.key === k), `${pr.name}.${fx.type}.${k}`);
  }
  assert.throws(() => createEffect('nope'));
  for (const t of TEXT_PRESETS) assert.equal(createTextClip(t, 0).type, 'text');
  for (const g of GEN_PRESETS) assert.ok(createGeneratorClip(g, 0).gen.params.density > 0);
  assert.notEqual(uid(), uid());
});

test('premium presets: audio-bound presets carry bindings; text fx and generator growth are wired', () => {
  const punch = instantiatePreset(EFFECT_PRESETS.find((p) => p.name === 'Beat Punch (audio)'));
  assert.equal(punch[0].bindings.amount.source, 'beat');
  punch[0].bindings.amount.amount = 0; // instances must not share binding objects with the preset
  assert.equal(instantiatePreset(EFFECT_PRESETS.find((p) => p.name === 'Beat Punch (audio)'))[0].bindings.amount.amount, 0.5);
  for (const t of TEXT_PRESETS) assert.ok(createTextClip(t, 0).text.fx, t.name);
  const g = createGeneratorClip(GEN_PRESETS[0], 0, 6);
  assert.deepEqual(g.gen.keyframes.growth.map((k) => k.v), [0, 1]);
  assert.equal(g.props.blend, 'screen');
  assert.equal(Object.keys(EFFECTS).length, 31);
});

test('speed: duration follows source span, trims/splits respect it, tempo chains stay in atempo range', () => {
  const p = fixture();
  const c = addMediaClip(p, 'v', vTrack(p), 0); // 10s source
  c.keyframes.opacity = [{ t: 0, v: 0 }, { t: 10, v: 1 }];
  assert.ok(setSpeed(p, c.id, 2)); assert.equal(c.duration, 5); assert.equal(c.keyframes.opacity[1].t, 5, 'keys stretch with the clip');
  const r = splitClip(p, c.id, 2); assert.equal(r.in, 4, 'split advances the source by local*speed');
  trimEnd(p, r.id, 100); assert.ok(r.in + r.duration * 2 <= 10 + 1e-9, 'cannot play past the end of the source');
  trimStart(p, r.id, r.start + 1); assert.equal(r.in, 6);
  const blocker = addMediaClip(p, 'i', vTrack(p), c.start + c.duration);
  assert.equal(setSpeed(p, c.id, 0.5), false, 'slowing down would run into the next clip');
  assert.equal(setSpeed(p, c.id, 9), false); assert.equal(setSpeed(p, c.id, 0), false);
  assert.equal(tempoChain(1), ''); assert.equal(tempoChain(2), 'atempo=2.00000,');
  assert.equal(tempoChain(4), 'atempo=2,atempo=2.00000,'); assert.equal(tempoChain(0.25), 'atempo=0.5,atempo=0.50000,');
  const q = fixture(); const a = addMediaClip(q, 'a', aTrack(q), 0); a.speed = 2; a.duration = 4; a.fadeIn = 0.5; a.fadeOut = 1;
  const g = buildAudioGraph(q).filter;
  assert.ok(g.includes('atrim=start=0.0000:end=8.0000') && g.includes('atempo=2.00000') && g.includes('afade=t=in:st=0:d=0.500') && g.includes('afade=t=out:st=3.000:d=1.000'), g);
  assert.equal(fadeFilters({ duration: 2, fadeIn: 0, fadeOut: 0 }), '');
});

test('montage planner: contiguous, beat-aligned, within source bounds, deterministic, uses every clip before repeating', () => {
  const beats = Array.from({ length: 16 }, (_, i) => 0.5 + i * 0.5); // 120 bpm
  const media = [{ id: 'a', kind: 'video', duration: 6 }, { id: 'b', kind: 'video', duration: 3 }, { id: 'c', kind: 'image', duration: 0 }];
  const plan = planMontage({ beats, every: 2, total: 8.5, media, seed: 7 });
  assert.equal(plan[0].start, 0);
  for (let i = 1; i < plan.length; i++) assert.ok(Math.abs(plan[i].start - (plan[i - 1].start + plan[i - 1].duration)) < 1e-9, 'gapless');
  assert.ok(Math.abs(plan.at(-1).start + plan.at(-1).duration - 8.5) < 1e-9, 'fills to the end of the music');
  for (const s of plan) { const m = media.find((x) => x.id === s.mediaId); assert.ok(m.kind === 'image' || s.in + s.duration <= m.duration + 1e-9, `${s.mediaId} stays inside its source`); }
  assert.deepEqual(plan.slice(1, -1).map((s) => +(s.start + s.duration).toFixed(2)).slice(0, 3), [1.5, 2.5, 3.5], 'cuts land on beats 0,2,4… (1s apart) — i.e. real beat times');
  assert.deepEqual(plan, planMontage({ beats, every: 2, total: 8.5, media, seed: 7 }), 'same seed -> same plan');
  assert.notDeepEqual(plan.map((s) => s.mediaId), planMontage({ beats, every: 2, total: 8.5, media, seed: 8 }).map((s) => s.mediaId));
  assert.deepEqual(new Set(plan.slice(0, 3).map((s) => s.mediaId)).size, 3, 'first three cuts use three different sources');
  assert.deepEqual(planMontage({ beats, every: 2, total: 8, media: [{ id: 'x', kind: 'audio', duration: 9 }] }), [], 'audio-only media is ignored');
});

test('roots: deterministic, bounded, tapered, births normalised, branching increases with density', () => {
  const a = buildRoots({ seed: 5, density: 1, aspect: 16 / 9 }), b = buildRoots({ seed: 5, density: 1, aspect: 16 / 9 });
  assert.deepEqual(Array.from(a.segs), Array.from(b.segs), 'same seed -> same roots');
  assert.notDeepEqual(Array.from(a.segs.slice(0, 40)), Array.from(buildRoots({ seed: 6, density: 1 }).segs.slice(0, 40)));
  assert.ok(a.count > 100 && a.count <= 7000, `segments ${a.count}`);
  let maxBirth = 0, minBirth = 1, thinner = 0;
  for (let i = 0; i < a.count; i++) { const o = i * 8; maxBirth = Math.max(maxBirth, a.segs[o + 6]); minBirth = Math.min(minBirth, a.segs[o + 6]); if (a.segs[o + 5] <= a.segs[o + 4] + 1e-9) thinner++; }
  assert.ok(maxBirth <= 1 + 1e-6 && minBirth >= 0, 'births within 0..1'); assert.equal(thinner, a.count, 'every segment tapers (never widens)');
  assert.ok(buildRoots({ seed: 5, density: 3 }).count > buildRoots({ seed: 5, density: 0.4 }).count, 'denser -> more segments');
  for (const origin of [0, 1, 2, 3]) assert.ok(buildRoots({ origin }).count > 20, `origin ${origin}`);
  const depths = new Set(); for (let i = 0; i < a.count; i++) depths.add(a.segs[i * 8 + 7]); assert.ok(depths.size >= 3, 'trunk + several branch orders');
});

test('transitions: active only during the first seconds, decaying envelope, none is inert', async () => {
  const { transitionAt: ta } = await import('../src/shared/params.js');
  const c = { transition: { type: 'flash', duration: 0.4 } };
  const a = ta(c, 0), b = ta(c, 0.2), e = ta(c, 0.39);
  assert.ok(a.effects[0].params.brightness > b.effects[0].params.brightness && b.effects[0].params.brightness > e.effects[0].params.brightness, 'flash decays');
  assert.equal(ta(c, 0.4), null); assert.equal(ta(c, 2), null); assert.equal(ta(c, -1), null);
  assert.equal(ta({ transition: { type: 'none', duration: 1 } }, 0.1), null); assert.equal(ta({}, 0.1), null);
  for (const type of ['punch', 'glitch', 'whip']) { const r = ta({ transition: { type, duration: 0.3 } }, 0.05); assert.ok(r.effects.length >= 1 && r.scaleMul >= 1, type); }
});

test('export audio graph pads to a finite length (an unbounded apad makes the AAC encoder spin at 100% CPU)', () => {
  const p = fixture(); addMediaClip(p, 'v', vTrack(p), 0); addMediaClip(p, 'a', aTrack(p), 2);
  const g = buildAudioGraph(p).filter;
  assert.match(g, /apad=whole_dur=\d/); assert.ok(!/apad,/.test(g), 'no bare apad');
});

test('multi-select: group move is atomic and clamped; delete and ripple close gaps per track', () => {
  const p = fixture();
  const v1 = vTrack(p), v2 = p.tracks.find((t) => t.name === 'V2').id;
  const mk = (id, track, start, dur) => { const c = addMediaClip(p, 'i', track, start); c.id = id; c.start = start; c.duration = dur; return c; };
  const a = mk('A', v1, 0, 2), b = mk('B', v1, 2, 2), c = mk('C', v1, 4, 2), d = mk('D', v2, 1, 2);
  assert.equal(moveClips(p, ['A', 'D'], 1), false, 'A would land on B (not part of the move)'); assert.equal(a.start, 0); assert.equal(d.start, 1);
  assert.ok(moveClips(p, ['A', 'B', 'C'], 3)); assert.deepEqual([a.start, b.start, c.start], [3, 5, 7], 'whole block moved together');
  assert.ok(moveClips(p, ['A', 'B', 'C', 'D'], -10)); assert.deepEqual([a.start, b.start, c.start, d.start], [2, 4, 6, 0], 'clamped so the earliest clip in the group (D) stops at 0 and the rest keep their spacing');
  assert.equal(deleteClips(p, ['B'], { ripple: true }), 1); assert.equal(c.start, 4, 'ripple pulled C left by B\'s length (6 -> 4)'); assert.equal(d.start, 0, 'other tracks untouched');
  const q = fixture(); const v = vTrack(q);
  const x = addMediaClip(q, 'i', v, 0), y = addMediaClip(q, 'i', v, 5), z = addMediaClip(q, 'i', v, 10);
  deleteClips(q, [x.id, y.id], { ripple: true }); assert.equal(z.start, 10 - 10, 'both removed lengths accumulate'); 
  const r = fixture(); const rx = addMediaClip(r, 'i', vTrack(r), 0), ry = addMediaClip(r, 'i', vTrack(r), 5);
  deleteClips(r, [rx.id]); assert.equal(ry.start, 5, 'plain delete leaves the gap');
});

test('loudness normalisation is opt-in per project and lands at the end of the audio graph', () => {
  const p = fixture(); addMediaClip(p, 'v', vTrack(p), 0);
  assert.ok(!buildAudioGraph(p).filter.includes('loudnorm'));
  p.audio = { normalize: true };
  const g = buildAudioGraph(p).filter;
  assert.match(g, /atrim=end=[\d.]+,loudnorm=I=-14:TP=-1\.5:LRA=11\[aout\]/);
});
