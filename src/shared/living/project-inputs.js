// What the Project DNA is derived from, read out of the project in plain numbers. All pure; the glue that calls ffmpeg-backed footage
// analysis lives in the UI. Same project, same numbers.
import { hslToHex } from '../mutation/mutate.js';

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const mean = (a) => { let s = 0; for (const v of a) s += v; return a.length ? s / a.length : 0; };

/** Averages of the audio analysis (rms/bass/mid/high are already 0..1) and its tempo. */
export function summariseAudio(a) {
  if (!a) return { bpm: null, energy: { rms: 0, bass: 0, mid: 0, high: 0 }, beats: 0 };
  return { bpm: a.bpm || null, energy: { rms: mean(a.rms), bass: mean(a.bass), mid: mean(a.mid), high: mean(a.high) }, beats: a.beats?.length || 0 };
}

/**
 * How many cuts a minute the picture has: video-track clips (not layers) over the timeline length, squeezed to 0..1 (40 a minute = 1).
 */
export function cutDensity(project) {
  const video = new Set(project.tracks.filter((t) => t.kind === 'video').map((t) => t.id));
  const clips = project.clips.filter((c) => video.has(c.trackId) && (c.type === 'media' || c.type === 'text' || c.type === 'shape'));
  if (!clips.length) return 0;
  const end = Math.max(...clips.map((c) => c.start + c.duration)), start = Math.min(...clips.map((c) => c.start));
  const minutes = Math.max(1 / 6, (end - start) / 60);
  return clamp01(clips.length / minutes / 40);
}

/** Seconds each media file is on the timeline (its weight in the project's look). */
export function usage(project) {
  const w = new Map();
  for (const c of project.clips) if (c.type === 'media' && c.mediaId) w.set(c.mediaId, (w.get(c.mediaId) || 0) + c.duration);
  return w;
}

/**
 * Palette and motion from the cached footage analysis (main/footage.js: per file, series of hue/sat/mean/motion at a few frames a
 * second, or a single `still`). @param items [{weight, analysis?, still?}]
 * @returns {{palette: string[], motion: number}} up to five colours: the commonest hues as they really look, plus a dark and a light
 */
export function paletteFromFootage(items) {
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, hx: 0, hy: 0, sat: 0, lum: 0 }));
  let total = 0, lumSum = 0, lumW = 0, motion = 0, motionW = 0;
  const add = (hue, sat, lum, w) => {
    lumSum += lum * w; lumW += w;
    if (hue < 0 || sat < 0.12) return;
    const b = buckets[Math.min(11, Math.floor(hue / 30))], a = (hue * Math.PI) / 180, k = w * sat;
    b.w += k; b.hx += Math.cos(a) * k; b.hy += Math.sin(a) * k; b.sat += sat * k; b.lum += lum * k; total += k;
  };
  for (const it of items) {
    const w = Math.max(0.01, it.weight || 1);
    if (it.analysis?.n) {
      const A = it.analysis, step = Math.max(1, Math.floor(A.n / 120)); // a couple of hundred samples are plenty
      let c = 0;
      for (let i = 0; i < A.n; i += step) { add(A.hue[i], A.sat[i], A.mean[i], w / Math.ceil(A.n / step)); c++; }
      motion += clamp01(mean(A.motion) * 8) * w; motionW += w;
    } else if (it.still) { add(it.still.hue ?? -1, it.still.sat ?? 0, it.still.mean ?? 0.5, w); motionW += w; }
  }
  const top = buckets.map((b, i) => ({ b, i })).filter((x) => x.b.w > total * 0.06).sort((x, y) => y.b.w - x.b.w).slice(0, 4);
  const palette = top.map(({ b }) => {
    const hue = ((Math.atan2(b.hy, b.hx) * 180) / Math.PI + 360) % 360;
    return hslToHex(hue, clamp01(b.sat / b.w * 1.15 + 0.08), Math.min(0.68, Math.max(0.28, b.lum / b.w)));
  });
  const lead = top.length ? ((Math.atan2(top[0].b.hy, top[0].b.hx) * 180) / Math.PI + 360) % 360 : 150;
  const l = lumW ? lumSum / lumW : 0.4;
  palette.push(hslToHex(lead, 0.22, Math.min(0.14, 0.04 + l * 0.12)), hslToHex(lead, 0.18, Math.max(0.82, 0.9 - (1 - l) * 0.06)));
  return { palette: palette.slice(0, 5), motion: motionW ? clamp01(motion / motionW) : 0 };
}

/** Everything the derivation needs, from a project, its audio analysis and the footage analysis ({mediaId: {analysis|still}}). */
export function collectInputs({ project, analysis, footage = {}, styleBias = {}, mutateSeeds = [] }) {
  const audio = summariseAudio(analysis);
  const w = usage(project);
  const items = [...w.entries()].map(([id, weight]) => ({ weight, ...(footage[id] || {}) })).filter((x) => x.analysis || x.still);
  const look = paletteFromFootage(items);
  const clips = project.clips.filter((c) => c.type === 'media' || c.type === 'text' || c.type === 'shape');
  const duration = clips.length ? Math.max(...clips.map((c) => c.start + c.duration)) : 0;
  return { bpm: audio.bpm, energy: audio.energy, density: cutDensity(project), motion: look.motion, palette: look.palette, duration, styleBias, mutateSeeds: mutateSeeds.filter(Number.isFinite).slice(0, 8) };
}
