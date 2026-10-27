// Smart montage, renderer side: gathers footage analysis (main process) + music structure, asks the pure planner for the cut list,
// and writes it into the project as ONE undoable step on a new video track.
import { store } from '../store.js';
import { addTrack, addMediaClip } from '/shared/timeline.js';
import { musicStructure } from '/shared/music-structure.js';
import { planSmartMontage, MONTAGE_STYLES, reframeFor } from '/shared/smart-montage.js';
import { EFFECT_PRESETS, instantiatePreset } from '/shared/effects-defs.js';

export { MONTAGE_STYLES };
export const MONTAGE_DEFAULTS = { style: 'hype', intensity: 0.5, reframe: true, seed: 1 };

/** Footage + music, analysed. `analysis` is the audio analysis (store.analysis). Read-only. */
export async function prepare({ project = store.project, analysis = store.analysis, onStep = () => {}, signal } = {}) {
  const media = project.media.filter((m) => (m.kind === 'video' || m.kind === 'image') && !m.missing);
  if (!media.length) throw new Error('Import some video clips or images first.');
  if (!analysis?.beats?.length) throw new Error('No beats found — add a music track to the timeline first.');
  onStep('footage', `Looking at ${media.length} clip${media.length === 1 ? '' : 's'}…`);
  const res = await window.hh.montageAnalyze(media.map((m) => ({ id: m.id, path: m.path, kind: m.kind })));
  if (signal?.aborted) throw new Error('Cancelled.');
  const sources = media.map((m) => ({ id: m.id, name: m.name, kind: m.kind, duration: m.kind === 'image' ? 0 : m.duration, width: m.width, height: m.height, analysis: res[m.id]?.analysis || null, still: res[m.id]?.still || null, error: res[m.id]?.error || null }));
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
  const made = [];
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
    if (p) clip.effects = instantiatePreset(p);
    if (seg.transition && seg.transition !== 'none') clip.transition = { type: seg.transition, duration: seg.transition === 'glitch' ? 0.16 : 0.2 };
    if (seg.role === 'hero') clip.name = `★ ${clip.name}`;
    made.push(clip);
  }
  return { track, clips: made };
}

export async function runSmartMontage({ opts = {}, onStep = () => {}, signal, ensureAnalysis } = {}) {
  if (ensureAnalysis && (!store.analysis || store.analysisStale)) { onStep('audio', 'Analysing the music…'); await ensureAnalysis(); }
  const prep = await prepare({ onStep, signal });
  onStep('plan', 'Choosing shots…');
  const plan = buildPlan({ prep, opts });
  if (!plan.segments.length) throw new Error('Could not build a montage from this material.');
  onStep('apply', 'Building the timeline…');
  store.snapshot();
  const r = applyPlan({ project: store.project, plan, opts, prep });
  store.touch('project');
  return { plan, prep, ...r };
}
