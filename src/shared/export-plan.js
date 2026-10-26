// Builds ffmpeg argument lists. Pure functions so they can be unit-tested without ffmpeg.
import { clipEnd, projectDuration } from './timeline.js';
import { findMedia, findTrack } from './project.js';

export const QUALITY = {
  draft: { crf: 28, preset: 'veryfast', vp9crf: 40 },
  standard: { crf: 21, preset: 'medium', vp9crf: 33 },
  high: { crf: 17, preset: 'slow', vp9crf: 26 },
};
export const FORMATS = {
  mp4: { ext: 'mp4', label: 'H.264 / AAC (.mp4)' },
  webm: { ext: 'webm', label: 'VP9 / Opus (.webm)' },
};

/** Clips that contribute audio to the mix. `playPath` honours proxies only for playback. */
export function audioSources(project) {
  return project.clips
    .map((clip) => ({ clip, media: clip.type === 'media' ? findMedia(project, clip.mediaId) : null, track: findTrack(project, clip.trackId) }))
    .filter(({ media, track }) => media && media.hasAudio && track && !track.muted);
}

/**
 * Returns {inputs:[path...], filter:string|null, mapLabel:string|null} for the audio mix of the project.
 * Input indexes start at `firstInput` so callers can prepend the raw video input.
 */
export function buildAudioGraph(project, firstInput = 0, sampleRate = 48000) {
  const srcs = audioSources(project);
  if (!srcs.length) return { inputs: [], filter: null, mapLabel: null };
  const parts = [];
  const labels = [];
  srcs.forEach(({ clip, media }, n) => {
    const idx = firstInput + n;
    const ms = Math.round(clip.start * 1000);
    parts.push(
      `[${idx}:a]atrim=start=${clip.in.toFixed(4)}:end=${(clip.in + clip.duration).toFixed(4)},asetpts=PTS-STARTPTS,` +
        `aresample=${sampleRate},aformat=channel_layouts=stereo,volume=${(clip.volume ?? 1).toFixed(3)},adelay=${ms}|${ms}[a${n}]`,
    );
    labels.push(`[a${n}]`);
  });
  const total = Math.max(0.1, projectDuration(project));
  parts.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,apad,atrim=end=${total.toFixed(4)}[aout]`);
  return { inputs: srcs.map((s) => s.media.path), filter: parts.join(';'), mapLabel: '[aout]' };
}

/** ffmpeg args that decode the project's audio mix to mono f32le on stdout (for analysis). */
export function buildAnalysisArgs(project, sampleRate = 22050) {
  const g = buildAudioGraph(project, 0, sampleRate);
  if (!g.filter) return null;
  const args = ['-hide_banner', '-loglevel', 'error'];
  g.inputs.forEach((p) => args.push('-i', p));
  args.push('-filter_complex', `${g.filter};[aout]aformat=channel_layouts=mono[m]`, '-map', '[m]', '-f', 'f32le', '-ar', String(sampleRate), '-ac', '1', 'pipe:1');
  return args;
}

export function validateExportSettings(s) {
  const errs = [];
  if (!(s.width >= 16 && s.width <= 7680 && s.height >= 16 && s.height <= 4320)) errs.push('Resolution is out of range.');
  if (!(s.fps >= 1 && s.fps <= 120)) errs.push('Frame rate must be between 1 and 120.');
  if (!QUALITY[s.quality]) errs.push(`Unknown quality "${s.quality}".`);
  if (!FORMATS[s.format]) errs.push(`Unknown format "${s.format}".`);
  if (!(s.duration > 0)) errs.push('Project is empty — nothing to render.');
  if (!s.outPath) errs.push('No output file chosen.');
  return errs;
}

/** Full ffmpeg arguments: raw RGBA frames on stdin + project audio mix. */
export function buildExportArgs(project, s) {
  const q = QUALITY[s.quality];
  const even = (n) => n - (n % 2);
  const w = even(s.width), h = even(s.height);
  const args = ['-hide_banner', '-y', '-progress', 'pipe:2', '-nostats',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${s.width}x${s.height}`, '-framerate', String(s.fps), '-i', 'pipe:0'];
  const audio = buildAudioGraph(project, 1);
  audio.inputs.forEach((p) => args.push('-i', p));
  // Frames arrive bottom-up from glReadPixels, hence vflip.
  const v = `[0:v]vflip,scale=${w}:${h}:flags=lanczos,format=yuv420p[vout]`;
  args.push('-filter_complex', audio.filter ? `${v};${audio.filter}` : v, '-map', '[vout]');
  if (audio.mapLabel) args.push('-map', audio.mapLabel);
  if (s.format === 'webm') args.push('-c:v', 'libvpx-vp9', '-crf', String(q.vp9crf), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4');
  else args.push('-c:v', 'libx264', '-crf', String(q.crf), '-preset', q.preset, '-movflags', '+faststart');
  if (audio.mapLabel) args.push(...(s.format === 'webm' ? ['-c:a', 'libopus', '-b:a', '160k'] : ['-c:a', 'aac', '-b:a', '192k']));
  args.push('-r', String(s.fps), '-t', s.duration.toFixed(4), s.outPath);
  return args;
}

export { clipEnd };
