// One-click TikTok edit: speech -> (transcribe) -> cut silences/fillers -> captions -> 9:16 reframe -> look -> loudness.
// Everything before the final `apply` step is read-only; the project is changed in ONE undoable step at the end.
import { store } from '../store.js';
import { findMedia, findTrack, uid } from '/shared/project.js';
import { clipEnd, addClipRaw } from '/shared/timeline.js';
import { addTrack } from '/shared/timeline.js';
import { detectSpeech, buildKeepRanges, buildTimeMap, remapWords, planReframe, punchLevels, dropHallucinations } from '/shared/autoedit.js';
import { wordsForPhrase } from '/shared/transcript.js';
import { isFiller } from '/shared/thai.js';
import { planCaptions } from '/shared/captions.js';
import { createCaptionClip } from '/shared/caption-styles.js';
import { parseSubtitles } from '/shared/srt.js';
import { EFFECT_PRESETS, instantiatePreset, createEffect } from '/shared/effects-defs.js';

export const LOOKS = {
  none: { label: 'None' },
  clean: { label: 'Clean Punch (light grade + grain)', chain: () => [createEffect('color', { contrast: 1.08, saturation: 1.12 }), createEffect('film', { grain: 0.14, halation: 0.12, vignette: 0.15, lift: 0.02, weave: 0 })] },
  'Xerox Photocopy': { label: 'Xerox Photocopy' },
  'Halation 35mm': { label: 'Halation 35mm' },
  'Tour Tape (VHS)': { label: 'Tour Tape (VHS)' },
  'Midnight Purple': { label: 'Midnight Purple' },
};

export const DEFAULTS = {
  language: 'th', model: 'balanced', captionStyle: 'pop', cutSilence: true, sensitivity: 0.5, minSilence: 0.35, removeFillers: true,
  punch: true, reframe: 'fill', setCanvas: true, look: 'clean', normalize: true, captions: true,
};

const NO_SPEECH = 'No speech was found in this clip (or it is too quiet). Try a clip with a clearer voice, or raise the silence sensitivity.';

/** Picks the clip to edit: the selection if it is a media clip with audio, else the first such clip on a video track. */
export function pickSourceClip(project, selectedId) {
  const ok = (c) => c.type === 'media' && findMedia(project, c.mediaId)?.hasAudio && findMedia(project, c.mediaId)?.kind !== 'image';
  const sel = project.clips.find((c) => c.id === selectedId);
  if (sel && ok(sel)) return sel;
  const vtracks = new Set(project.tracks.filter((t) => t.kind === 'video').map((t) => t.id));
  return project.clips.filter((c) => ok(c) && vtracks.has(c.trackId)).sort((a, b) => a.start - b.start)[0] || null;
}

function segmentsToWords(segments, env) {
  return segments.flatMap((s) => wordsForPhrase(s.text, s.start, s.end, env));
}

/**
 * Phase 1 (read-only): audio -> envelope, speech ranges, words.
 * @param {object} o {project, clip, opts, transcribe?, subtitles?, onStep, signal}
 */
export async function analyze({ project, clip, opts, transcribe, subtitles, onStep = () => {}, signal }) {
  const media = findMedia(project, clip.mediaId);
  const speed = clip.speed || 1;
  onStep('audio', 'Reading the audio…');
  const ex = await window.hh.asrExtract({ path: media.path, start: clip.in, duration: clip.duration * speed });
  const env = { rate: ex.env.rate, rms: new Float32Array(ex.env.rms) };
  const total = ex.seconds;
  const speech = detectSpeech(env, { minSilence: opts.minSilence, sensitivity: opts.sensitivity });
  if (signal?.aborted) throw new Error('Cancelled.');

  let segments;
  if (subtitles) {
    onStep('transcribe', 'Reading the subtitle file…');
    segments = parseSubtitles(subtitles).map((c) => ({ text: c.text.replace(/\n/g, ' '), start: c.start - clip.in, end: c.end - clip.in })).filter((s) => s.end > 0 && s.start < total).map((s) => ({ ...s, start: Math.max(0, s.start), end: Math.min(total, s.end) }));
    if (!segments.length) throw new Error('That subtitle file has no lines that fall inside this clip.');
  } else if (transcribe) {
    onStep('transcribe', 'Transcribing…');
    segments = await transcribe({ token: ex.token, env, total });
  } else {
    onStep('transcribe', 'Transcribing Thai speech…');
    const st = await window.hh.asrStatus();
    if (!st.models[opts.model]?.installed) { const e = new Error(`The "${st.models[opts.model]?.label || opts.model}" speech model is not downloaded yet.`); e.code = 'NO_MODEL'; throw e; }
    segments = (await window.hh.asrTranscribe({ token: ex.token, model: opts.model, language: opts.language })).segments;
  }
  if (signal?.aborted) throw new Error('Cancelled.');
  segments = dropHallucinations(segments, speech);
  const words = segmentsToWords(segments, env);
  if (!speech.length && !words.length) throw new Error(NO_SPEECH);
  return { env, total, speech, segments, words, token: ex.token };
}

/** Builds the full plan without touching the project, so the UI can show numbers and tests can inspect it. */
export function plan({ project, clip, opts, data }) {
  const media = findMedia(project, clip.mediaId);
  const keep = buildKeepRanges({ speech: data.speech, words: data.words, total: data.total, cutSilence: opts.cutSilence, removeFillers: opts.removeFillers, minSilence: opts.minSilence, isFiller });
  if (!keep.length) throw new Error(NO_SPEECH);
  const timeMap = buildTimeMap(keep);
  const speed = clip.speed || 1;
  const words = remapWords(data.words.filter((w) => !(opts.removeFillers && isFiller(w.text))), timeMap).map((w) => ({ ...w, start: clip.start + w.start / speed, end: clip.start + w.end / speed }));
  const canvas = opts.setCanvas ? { width: 1080, height: 1920 } : { width: project.settings.width, height: project.settings.height };
  const reframe = opts.reframe === 'none' ? { scale: 1, background: false } : planReframe({ srcW: media.width, srcH: media.height, dstW: canvas.width, dstH: canvas.height, mode: opts.reframe });
  const cards = opts.captions ? planCaptions(words, { maxWidth: 16, maxLines: 2, dropFillers: true }) : [];
  return {
    keep, timeMap, words, cards, canvas, reframe, speed,
    before: clip.duration, after: timeMap.duration / speed,
  };
}

/** Phase 2: mutate the project (caller takes the undo snapshot). Returns a summary. */
export function apply({ project, clip, opts, p }) {
  const media = findMedia(project, clip.mediaId);
  const mainTrack = findTrack(project, clip.trackId);
  const sp = p.speed;
  const levels = opts.punch ? punchLevels(p.keep.length) : p.keep.map(() => 1);
  const lookChain = () => {
    if (opts.look === 'none') return [];
    if (LOOKS[opts.look]?.chain) return LOOKS[opts.look].chain();
    const preset = EFFECT_PRESETS.find((x) => x.name === opts.look);
    return preset ? instantiatePreset(preset) : [];
  };
  if (opts.setCanvas) { project.settings.width = p.canvas.width; project.settings.height = p.canvas.height; }

  // 1) replace the source clip by its kept pieces, laid back to back, and ripple later clips on the track
  const pieces = [];
  let dst = 0;
  p.keep.forEach((r, i) => {
    const c = structuredClone(clip);
    c.id = uid('clip');
    c.in = clip.in + r.start;
    c.duration = (r.end - r.start) / sp;
    c.start = clip.start + dst;
    dst += c.duration;
    c.fadeIn = 0; c.fadeOut = 0; c.keyframes = {};
    c.props.scale = (c.props.scale || 1) * p.reframe.scale * levels[i];
    c.effects = [...c.effects.map((e) => ({ ...structuredClone(e), id: uid('fx') })), ...lookChain()];
    c.name = `${clip.name || media.name} · ${i + 1}`;
    pieces.push(c);
  });
  const delta = clip.duration - dst;
  const origEnd = clipEnd(clip);
  project.clips = project.clips.filter((c) => c.id !== clip.id);
  for (const c of project.clips) if (c.trackId === clip.trackId && c.start >= origEnd - 1e-6) c.start = Math.max(0, c.start - delta);
  project.clips.push(...pieces);

  // 2) blurred full-frame backdrop for non-portrait sources (muted track below the main one)
  if (p.reframe.background) {
    const idx = project.tracks.findIndex((t) => t.id === mainTrack.id);
    const bg = { id: uid('trk'), name: 'BG', kind: 'video', muted: true, hidden: false };
    project.tracks.splice(idx + 1, 0, bg);
    for (const c of pieces) {
      const b = structuredClone(c);
      b.id = uid('clip'); b.trackId = bg.id; b.name = `BG ${c.name}`;
      b.props.scale = p.reframe.backgroundScale; b.transition = { type: 'none', duration: 0.25 };
      b.effects = [createEffect('blur', { radius: 46 }), createEffect('color', { brightness: -0.28, saturation: 1.1 })];
      project.clips.push(b);
    }
  }

  // 3) captions on a new top track
  let captionClips = [];
  if (p.cards.length) {
    const cap = addTrack(project, 'video');
    cap.name = 'CAP';
    captionClips = p.cards.map((card) => addClipRaw(project, createCaptionClip(card, opts.captionStyle, { trackId: cap.id })));
  }

  project.audio = { ...(project.audio || {}), normalize: !!opts.normalize };
  return {
    cuts: pieces.length, before: p.before, after: dst, removed: p.before - dst, words: p.words.length, captions: captionClips.length,
    pieceIds: pieces.map((c) => c.id),
  };
}

/** Whole pipeline in one call. `data` may be passed to skip phase 1 (used by the panel to preview the plan). */
export async function runAutoEdit({ opts: userOpts = {}, clipId = null, transcribe, subtitles, onStep = () => {}, signal } = {}) {
  const opts = { ...DEFAULTS, ...userOpts };
  const project = store.project;
  const clip = pickSourceClip(project, clipId ?? store.selection);
  if (!clip) throw new Error('Select a video clip that has speech in it first.');
  const data = await analyze({ project, clip, opts, transcribe, subtitles, onStep, signal });
  onStep('plan', 'Planning the edit…');
  const p = plan({ project, clip, opts, data });
  onStep('apply', 'Cutting, captioning, framing…');
  store.snapshot();
  const summary = apply({ project, clip, opts, p });
  store.select(summary.pieceIds[0]);
  store.setPlayhead(0);
  store.touch('project');
  store.transcript = { words: p.words, cards: p.cards };
  onStep('done', 'Done');
  return { ...summary, plan: p, data };
}
