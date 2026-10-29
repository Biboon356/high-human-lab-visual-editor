// Smart montage, renderer side: gathers footage analysis (main process) + music structure, asks the pure planner for the cut list,
// and writes it into the project as ONE undoable step on a new video track.
import { store } from '../store.js';
import { findMedia, findTrack } from '/shared/project.js';
import { addTrack, addMediaClip, addClipRaw, dissolveInto } from '/shared/timeline.js';
import { musicStructure, tempoAnalysis } from '/shared/music-structure.js';
import { audioSources } from '/shared/export-plan.js';
import { planSmartMontage, MONTAGE_STYLES, reframeFor } from '/shared/smart-montage.js';
import { EFFECT_PRESETS, instantiatePreset, createEffect } from '/shared/effects-defs.js';
import { ADJUST_LOOKS, ORGANIC_LOOKS, createAdjustClip } from '/shared/adjust-defs.js';
import { createLockupClips, LOCKUPS } from '/shared/text-defs.js';

export { MONTAGE_STYLES };
export const MONTAGE_DEFAULTS = { style: 'hype', intensity: 0.5, reframe: true, seed: 1, match: true, muteSource: true, title: false, titleKicker: '', titleText: '', lockup: LOCKUPS[0].name };

/** Footage + music, analysed. `analysis` is the audio analysis (store.analysis). Read-only. */
export async function prepare({ project = store.project, analysis = store.analysis, onStep = () => {}, signal } = {}) {
  const all = project.media.filter((m) => (m.kind === 'video' || m.kind === 'image') && !m.missing);
  if (!all.length) throw new Error('Import some video clips or images first.');
  const media = all.filter((m) => m.pick !== 'skip'); // clips the user marked ⊘ in the Library are left out
  if (!media.length) throw new Error('Every clip in the Library is marked “skip”. Un-skip at least one.');
  if (!analysis?.beats?.length) {
    const hasAudio = audioSources(project).length > 0;
    const e = new Error(hasAudio ? "I couldn't find a beat in the audio that's on the timeline (speech or ambient sound has no steady pulse)." : 'There is no music on the timeline yet.');
    e.code = hasAudio ? 'NO_BEATS' : 'NO_MUSIC';
    throw e;
  }
  onStep('footage', `Looking at ${media.length} clip${media.length === 1 ? '' : 's'}…`);
  const res = await window.hh.montageAnalyze(media.map((m) => ({ id: m.id, path: m.path, kind: m.kind })));
  if (signal?.aborted) throw new Error('Cancelled.');
  const sources = all.map((m) => ({ id: m.id, name: m.name, kind: m.kind, duration: m.kind === 'image' ? 0 : m.duration, width: m.width, height: m.height, pick: m.pick || null, analysis: res[m.id]?.analysis || null, still: res[m.id]?.still || null, error: res[m.id]?.error || null }));
  onStep('music', 'Listening to the structure of the music…');
  const structure = musicStructure(analysis);
  return { sources, structure, analysis, failed: sources.filter((s) => s.error) };
}

/** Pure: cut list + summary for the options. */
export function buildPlan({ prep, opts }) {
  const o = { ...MONTAGE_DEFAULTS, ...opts };
  return planSmartMontage({ beats: prep.analysis.beats, total: prep.analysis.duration, structure: prep.structure, sources: prep.sources, style: o.style, intensity: o.intensity, seed: o.seed });
}

/** Writes the plan into the project (caller takes the undo snapshot). Returns the new track and clips. */
export function applyPlan({ project, plan, opts, prep }) {
  const o = { ...MONTAGE_DEFAULTS, ...opts };
  const track = addTrack(project, 'video');
  const byId = new Map(prep.sources.map((s) => [s.id, s]));
  const canvas = { width: project.settings.width, height: project.settings.height };
  const preset = (name) => EFFECT_PRESETS.find((p) => p.name === name);
  const made = [], dissolves = [], before = new Set(project.clips.map((c) => c.id));
  const muteSource = o.muteSource !== false && !o.tempo && audioSources(project).length > 0; // the song is the soundtrack; the footage's own sound would fight it
  for (const seg of plan.segments) {
    const clip = addMediaClip(project, seg.mediaId, track.id, seg.start);
    if (!clip) continue;
    clip.start = seg.start; clip.duration = seg.duration; clip.in = seg.in;
    const src = byId.get(seg.mediaId);
    let scale = 1;
    if (o.reframe && src?.width) {
      const r = reframeFor(src, canvas, seg.focus);
      // only crop when the source's shape differs enough from the canvas to leave bars; matching shapes stay untouched
      if (r.scale > 1.02) { scale = r.scale; clip.props.x = r.x; clip.props.y = r.y; }
    }
    if (seg.punchIn) scale *= seg.punchIn;
    clip.props.scale = scale;
    if (seg.kenBurns) clip.keyframes.scale = [{ t: 0, v: scale }, { t: seg.duration, v: scale * seg.kenBurns }];
    const p = seg.look && preset(seg.look);
    clip.effects = p ? instantiatePreset(p) : [];
    if (o.match !== false && seg.match) clip.effects.unshift(createEffect('color', { brightness: seg.match.brightness || 0, saturation: seg.match.saturation || 1 })); // gentle exposure/saturation match first, look on top
    if (seg.slowmo) clip.speed = seg.slowmo; // hero shot at the drop in slow motion: the slot keeps its length, the source plays at half rate
    if (seg.role === 'outro') clip.fadeOut = Math.min(0.6, seg.duration * 0.5);
    if (seg.transition && seg.transition !== 'none' && seg.transition !== 'dissolve') clip.transition = { type: seg.transition, duration: seg.transition === 'glitch' ? 0.16 : 0.2 };
    if (seg.role === 'hero') clip.name = `★ ${clip.name}`;
    made.push(clip);
    if (seg.transition === 'dissolve') dissolves.push(clip.id);
  }
  // dissolves last: they move the incoming clip onto its own track and overlap it with the one before
  for (const id of dissolves) dissolveInto(project, id, 0.4);
  // the song is the soundtrack: silence the montage clips (and the helper clips a dissolve creates) and the footage already laid out below them
  if (muteSource) for (const c of project.clips) {
    const m = c.type === 'media' ? findMedia(project, c.mediaId) : null;
    if (m && (m.kind === 'video' || !before.has(c.id)) && findTrack(project, c.trackId)?.kind === 'video') c.volume = 0;
  }

  // a style can lay one adjustment layer over the whole cut (Y2K digicam, growing veins)
  const total = plan.segments.length ? plan.segments.at(-1).start + plan.segments.at(-1).duration : 0;
  const st = MONTAGE_STYLES[o.style];
  const look = st?.adjust && [...ADJUST_LOOKS, ...ORGANIC_LOOKS].find((l) => l.name === st.adjust);
  let adjust = null;
  if (look && total > 0) { adjust = createAdjustClip(look, 0, total); adjust.trackId = addTrack(project, 'video').id; addClipRaw(project, adjust); }

  // optional editorial title card on two more tracks above everything
  let title = null;
  if (o.title && (o.titleText || o.titleKicker) && total > 0) {
    const len = Math.min(3.5, Math.max(1.5, total / 3));
    const { clips, kicker, title: main } = createLockupClips(0.3, len, { lockup: o.lockup, kicker: o.titleKicker, title: o.titleText });
    // a blank field means "no line", not the lockup's sample words; a lockup's own sub line is sample text too, so it stays out of the cut
    const drop = new Set([...(o.titleText ? [] : [main]), ...(o.titleKicker ? [] : [kicker]), ...clips.filter((c) => c.name.startsWith('Sub'))]);
    for (const c of clips) if (!drop.has(c)) { c.trackId = addTrack(project, 'video').id; addClipRaw(project, c); }
    title = o.titleText ? main : kicker;
  }
  return { track, clips: made, adjust, title, mutedSource: muteSource };
}

/** Footage length as a default for "no music": every clip once, clamped to a sensible short-form range. */
export function suggestedSeconds(project = store.project) {
  const sum = project.media.filter((m) => (m.kind === 'video' || m.kind === 'image') && !m.missing).reduce((a, m) => a + (m.kind === 'image' ? 3 : m.duration || 0), 0);
  return Math.max(8, Math.min(30, Math.round(sum)));
}

export async function runSmartMontage({ opts = {}, onStep = () => {}, signal, ensureAnalysis } = {}) {
  let analysis = store.analysis;
  if (opts.tempo) analysis = tempoAnalysis(opts.tempo.bpm, opts.tempo.seconds); // no music: cut to a steady click instead
  else if (ensureAnalysis && (!store.analysis || store.analysisStale)) { onStep('audio', 'Analysing the music…'); analysis = await ensureAnalysis() || store.analysis; }
  const prep = await prepare({ onStep, signal, analysis });
  onStep('plan', 'Choosing shots…');
  const plan = buildPlan({ prep, opts });
  if (!plan.segments.length) throw new Error('Could not build a montage from this material.');
  onStep('apply', 'Building the timeline…');
  store.snapshot();
  const r = applyPlan({ project: store.project, plan, opts, prep });
  store.touch('project');
  return { plan, prep, ...r };
}
