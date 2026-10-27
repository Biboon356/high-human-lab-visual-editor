// Pure timeline operations. All functions mutate the project in place and return
// a boolean/ref describing the result; callers snapshot for undo before calling.
import { createClip, findClip, findMedia, findTrack } from './project.js';

export const MIN_CLIP = 0.1;
export const clipEnd = (c) => c.start + c.duration;

export function projectDuration(project) {
  return project.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

export function clipsOnTrack(project, trackId) {
  return project.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

export function overlaps(project, trackId, start, duration, ignoreId = null) {
  const end = start + duration;
  return project.clips.some(
    (c) => c.trackId === trackId && c.id !== ignoreId && start < clipEnd(c) - 1e-6 && end > c.start + 1e-6,
  );
}

/** Latest end on a track — handy for "append". */
export function trackEnd(project, trackId) {
  return clipsOnTrack(project, trackId).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

/** Kind of a clip as seen by track compatibility. */
export function clipKind(project, clip) {
  if (clip.type !== 'media') return 'visual';
  return findMedia(project, clip.mediaId)?.kind || 'visual';
}
export function canPlace(project, clip, track) {
  if (!track) return false;
  const k = clipKind(project, clip);
  return track.kind === 'audio' ? k === 'audio' : k !== 'audio';
}

/** Adds a clip for a media item. Returns the clip or null when it doesn't fit. */
export function addMediaClip(project, mediaId, trackId, start) {
  const media = findMedia(project, mediaId);
  const track = findTrack(project, trackId);
  if (!media || !track) return null;
  const duration = media.kind === 'image' ? 5 : Math.max(MIN_CLIP, media.duration || 5);
  const clip = createClip({ trackId, type: 'media', mediaId, name: media.name, start: Math.max(0, start), duration });
  if (!canPlace(project, clip, track)) return null;
  if (overlaps(project, trackId, clip.start, clip.duration)) clip.start = trackEnd(project, trackId);
  project.clips.push(clip);
  return clip;
}

export function addClipRaw(project, clip) {
  if (overlaps(project, clip.trackId, clip.start, clip.duration)) clip.start = trackEnd(project, clip.trackId);
  project.clips.push(clip);
  return clip;
}

/** Move a clip; rejects (returns false) if it would overlap or the track kind is wrong. */
export function moveClip(project, clipId, start, trackId = null) {
  const clip = findClip(project, clipId);
  if (!clip) return false;
  const track = findTrack(project, trackId || clip.trackId);
  start = Math.max(0, start);
  if (!canPlace(project, clip, track)) return false;
  if (overlaps(project, track.id, start, clip.duration, clip.id)) return false;
  clip.start = start;
  clip.trackId = track.id;
  return true;
}

function sourceLimit(project, clip) {
  if (clip.type !== 'media') return Infinity;
  const m = findMedia(project, clip.mediaId);
  return m && m.kind !== 'image' ? m.duration : Infinity;
}

/** Trim the left edge to a new timeline time. Adjusts in-point so content stays put. */
export function trimStart(project, clipId, newStart) {
  const clip = findClip(project, clipId);
  if (!clip) return false;
  const end = clipEnd(clip);
  let s = Math.min(newStart, end - MIN_CLIP);
  s = Math.max(s, 0);
  let delta = s - clip.start;
  const sp = clip.type === 'media' ? clip.speed || 1 : 1;
  if (clip.type === 'media') {
    if (clip.in + delta * sp < 0) { delta = -clip.in / sp; s = clip.start + delta; }
    clip.in += delta * sp;
  }
  const prev = project.clips.filter((c) => c.trackId === clip.trackId && c.id !== clip.id && clipEnd(c) <= clip.start + 1e-6);
  const floor = prev.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  if (s < floor) { clip.in += clip.type === 'media' ? (floor - s) * sp : 0; s = floor; }
  clip.start = s;
  clip.duration = end - s;
  return true;
}

export function trimEnd(project, clipId, newEnd) {
  const clip = findClip(project, clipId);
  if (!clip) return false;
  let e = Math.max(newEnd, clip.start + MIN_CLIP);
  const maxDur = (sourceLimit(project, clip) - (clip.type === 'media' ? clip.in : 0)) / (clip.type === 'media' ? clip.speed || 1 : 1);
  e = Math.min(e, clip.start + maxDur);
  const next = project.clips.filter((c) => c.trackId === clip.trackId && c.id !== clip.id && c.start >= clipEnd(clip) - 1e-6);
  const ceil = next.reduce((m, c) => Math.min(m, c.start), Infinity);
  e = Math.min(e, ceil);
  if (e - clip.start < MIN_CLIP) return false;
  clip.duration = e - clip.start;
  return true;
}

/** Split at timeline time t. Returns the new right-hand clip, or null. */
export function splitClip(project, clipId, t) {
  const clip = findClip(project, clipId);
  if (!clip) return null;
  if (t <= clip.start + MIN_CLIP || t >= clipEnd(clip) - MIN_CLIP) return null;
  const local = t - clip.start;
  const right = structuredClone(clip);
  right.id = createClip({}).id;
  right.start = t;
  right.duration = clip.duration - local;
  if (clip.type === 'media') right.in = clip.in + local * (clip.speed || 1);
  clip.duration = local;
  // keyframes are clip-relative: partition them at the cut
  const cut = (owner, ownerRight) => {
    for (const [k, keys] of Object.entries(owner.keyframes || {})) {
      owner.keyframes[k] = keys.filter((p) => p.t <= local);
      ownerRight.keyframes[k] = keys.filter((p) => p.t >= local).map((p) => ({ t: p.t - local, v: p.v }));
      if (!owner.keyframes[k].length) delete owner.keyframes[k];
      if (!ownerRight.keyframes[k].length) delete ownerRight.keyframes[k];
    }
  };
  cut(clip, right);
  clip.effects.forEach((fx, i) => cut(fx, right.effects[i]));
  if (clip.gen) cut(clip.gen, right.gen);
  project.clips.push(right);
  return right;
}

/** Move several clips by the same time delta. All-or-nothing; delta is clamped so nothing goes before 0.
 *  Rejects (returns false) if any moved clip would overlap a clip that is *not* part of the move. */
export function moveClips(project, ids, delta) {
  const set = new Set(ids);
  const clips = ids.map((id) => findClip(project, id)).filter(Boolean);
  if (!clips.length) return false;
  delta = Math.max(delta, -Math.min(...clips.map((c) => c.start)));
  for (const c of clips) {
    const ns = c.start + delta;
    const clash = project.clips.some((o) => !set.has(o.id) && o.trackId === c.trackId && ns < clipEnd(o) - 1e-6 && ns + c.duration > o.start + 1e-6);
    if (clash) return false;
  }
  for (const c of clips) c.start += delta;
  return true;
}

/** Delete several clips. With `ripple`, later clips on each affected track slide left to close the gaps. */
export function deleteClips(project, ids, { ripple = false } = {}) {
  const set = new Set(ids);
  const removed = project.clips.filter((c) => set.has(c.id));
  if (!removed.length) return 0;
  project.clips = project.clips.filter((c) => !set.has(c.id));
  if (ripple) {
    for (const c of project.clips) {
      const shift = removed.filter((r) => r.trackId === c.trackId && clipEnd(r) <= c.start + 1e-6).reduce((a, r) => a + r.duration, 0);
      if (shift) c.start = Math.max(0, c.start - shift);
    }
  }
  return removed.length;
}

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 4;

/** Changes playback speed keeping the same source span, so the clip gets shorter/longer on the timeline.
 *  Returns false (and changes nothing) if the new length would overlap a neighbour or exceed the source. */
export function setSpeed(project, clipId, speed) {
  const clip = findClip(project, clipId);
  if (!clip || clip.type !== 'media' || !(speed >= MIN_SPEED && speed <= MAX_SPEED)) return false;
  const span = clip.duration * (clip.speed || 1);
  const duration = span / speed;
  if (duration < MIN_CLIP || overlaps(project, clip.trackId, clip.start, duration, clip.id)) return false;
  const ratio = duration / clip.duration;
  clip.speed = speed;
  clip.duration = duration;
  // keyframes live in clip-relative time: stretch them with the clip so the animation keeps its shape
  for (const owner of [clip, clip.gen, ...(clip.effects || [])]) {
    for (const keys of Object.values(owner?.keyframes || {})) for (const k of keys) k.t *= ratio;
  }
  clip.fadeIn = Math.min(clip.fadeIn || 0, duration / 2);
  clip.fadeOut = Math.min(clip.fadeOut || 0, duration / 2);
  return true;
}

export function deleteClip(project, clipId) {
  const i = project.clips.findIndex((c) => c.id === clipId);
  if (i < 0) return false;
  project.clips.splice(i, 1);
  return true;
}

/** Visual clips active at time t, bottom-most track first (draw order). */
export function activeVisualClips(project, t) {
  const order = new Map(project.tracks.map((tr, i) => [tr.id, i]));
  return project.clips
    .filter((c) => {
      const tr = findTrack(project, c.trackId);
      if (!tr || tr.kind !== 'video' || tr.hidden) return false;
      return t >= c.start - 1e-6 && t < clipEnd(c) - 1e-6;
    })
    .sort((a, b) => order.get(b.trackId) - order.get(a.trackId) || a.start - b.start);
}

/** Clips that produce sound at time t (for preview). */
export function activeAudioClips(project, t) {
  return project.clips.filter((c) => {
    const tr = findTrack(project, c.trackId);
    const m = c.type === 'media' ? findMedia(project, c.mediaId) : null;
    return tr && !tr.muted && m && m.hasAudio && t >= c.start && t < clipEnd(c);
  });
}

export function addTrack(project, kind) {
  const same = project.tracks.filter((t) => t.kind === kind);
  const name = `${kind === 'video' ? 'V' : 'A'}${same.length + 1}`;
  const track = { id: `trk_${Math.random().toString(36).slice(2, 9)}`, name, kind, muted: false, hidden: false };
  if (kind === 'video') project.tracks.unshift(track);
  else project.tracks.push(track);
  return track;
}

const shiftKeys = (kf, d) => { for (const k of Object.keys(kf || {})) kf[k] = kf[k].map((p) => ({ ...p, t: p.t + d })); };

/**
 * Cross-dissolve into clip `clipId` from the picture clip that ends where it starts (any video track).
 * Editors' A/B-roll: the incoming clip moves onto its own track *directly above* the outgoing one and overlaps it by `seconds`;
 * whichever clip is on top fades (in or out), so the two pictures mix — and the sound crossfades with them.
 * The overlap comes from the incoming clip's head room if it has any (the dissolve then ends on the cut), otherwise from the
 * outgoing clip's tail. Returns {incoming, outgoing, seconds, track} or null when there is nothing to dissolve.
 */
export function dissolveInto(project, clipId, seconds = 0.5) {
  const B = project.clips.find((c) => c.id === clipId);
  if (!B || B.type !== 'media' || clipKind(project, B) === 'audio') return null;
  const vids = new Set(project.tracks.filter((t) => t.kind === 'video').map((t) => t.id));
  const P = project.clips.filter((c) => c.id !== B.id && c.type === 'media' && vids.has(c.trackId) && clipKind(project, c) !== 'audio' && Math.abs(clipEnd(c) - B.start) < 0.05)
    .sort((a, b) => clipEnd(b) - clipEnd(a))[0];
  if (!P) return null;
  const isImg = (c) => clipKind(project, c) === 'image';
  const spB = B.speed || 1, spP = P.speed || 1;
  const head = isImg(B) ? Infinity : B.in / spB;
  const tail = isImg(P) ? Infinity : ((findMedia(project, P.mediaId)?.duration || 0) - (P.in + P.duration * spP)) / spP;
  let d = Math.min(seconds, B.duration * 0.5, P.duration * 0.5);
  let mode = head >= d - 1e-6 ? 'head' : tail >= d - 1e-6 ? 'tail' : head >= tail ? 'head' : 'tail';
  d = Math.min(d, mode === 'head' ? head : tail);
  if (!(d >= 0.1)) return null;

  const newStart = mode === 'head' ? B.start - d : B.start, newEnd = clipEnd(B);
  // which track does the incoming clip live on? Its own, if it is already off the outgoing clip's track and has room; else one directly above.
  const free = (trackId, a, b) => !overlaps(project, trackId, a, b - a, B.id);
  let trackId = B.trackId;
  const pIdx = project.tracks.findIndex((t) => t.id === P.trackId);
  const fits = trackId !== P.trackId && free(trackId, newStart, newEnd);
  if (!fits) {
    const above = project.tracks[pIdx - 1];
    if (above && above.kind === 'video' && /\+$/.test(above.name) && free(above.id, newStart, newEnd)) trackId = above.id;
    else {
      const t = { id: `trk_${Math.random().toString(36).slice(2, 9)}`, name: `${project.tracks[pIdx].name.replace(/\+$/, '')}+`, kind: 'video', muted: false, hidden: false };
      project.tracks.splice(pIdx, 0, t);
      trackId = t.id;
    }
  }
  // the outgoing clip must keep the room it needs on its own track (its extended tail may not run into a neighbour)
  if (mode === 'tail' && overlaps(project, P.trackId, clipEnd(P), d, B.id)) return null;

  if (mode === 'head') {
    B.start = newStart; B.duration += d;
    if (!isImg(B)) B.in -= d * spB;
    shiftKeys(B.keyframes, d);
    for (const fx of B.effects || []) shiftKeys(fx.keyframes, d);
  } else {
    P.duration += d;
  }
  B.trackId = trackId;
  B.transition = { type: 'none', duration: 0.25 };
  const bIdx = project.tracks.findIndex((t) => t.id === B.trackId);
  if (bIdx < project.tracks.findIndex((t) => t.id === P.trackId)) B.fadeIn = Math.max(B.fadeIn || 0, d); // incoming is on top: it fades in
  else P.fadeOut = Math.max(P.fadeOut || 0, d);                                                          // outgoing is on top: it fades out
  return { incoming: B, outgoing: P, seconds: d, track: project.tracks[bIdx] };
}
