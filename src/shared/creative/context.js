// Creative Memory Engine, stage 2: UNDERSTAND. What is the artist doing RIGHT NOW? Inferred only from the selection, the clips around it
// and what they changed in the last twenty seconds. Temporary and present-focused: it is never saved, and it is not the Project DNA
// (the long-term character of the project). It answers with a kind and ONE short sentence saying why, so that anything built on it
// can explain itself.
import { relations } from '../living/accident.js';

export const CONTEXT_WINDOW_MS = 20000;
export const CONTEXT_KINDS = ['idle', 'connecting-scenes', 'text-over-scene', 'changing-rhythm', 'experimenting-motion', 'searching-look'];

const VISUAL = new Set(['media', 'text', 'shape', 'generator']);
const end = (c) => c.start + c.duration;

/**
 * @param o {project, selection: clip ids, recent: Observer.recent, now: ms}
 * @returns {{kind, clipIds: string[], why: string}}
 */
export function inferContext({ project, selection = [], recent = [], now = 0 } = {}) {
  const idle = { kind: 'idle', clipIds: [], why: '' };
  if (!project) return idle;
  const sel = selection.map((id) => project.clips.find((c) => c.id === id)).filter(Boolean);
  const fresh = recent.filter((e) => now - e.t <= CONTEXT_WINDOW_MS);
  const selIds = new Set(sel.map((c) => c.id));

  if (sel.length === 2) {
    const rel = relations(project);
    const [a, b] = sel.map((c) => c.id);
    const cut = rel.cuts.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    if (cut) return { kind: 'connecting-scenes', clipIds: [cut.a, cut.b], why: 'Two scenes sit side by side.' };
    const over = rel.overlaps.find((x) => (x.upper === a && x.lower === b) || (x.upper === b && x.lower === a));
    if (over) return { kind: 'connecting-scenes', clipIds: [over.lower, over.upper], why: 'One scene sits over another.' };
  }

  if (sel.length === 1 && sel[0].type === 'text') {
    const t = sel[0];
    const under = project.clips.find((c) => c.id !== t.id && VISUAL.has(c.type) && c.type !== 'text' && c.trackId !== t.trackId && c.start < end(t) && end(c) > t.start);
    if (under) return { kind: 'text-over-scene', clipIds: [t.id, under.id], why: 'This text sits over a scene.' };
  }

  if (fresh.filter((e) => e.kind === 'timing').length >= 3) return { kind: 'changing-rhythm', clipIds: [], why: 'You have been moving cuts around.' };
  if (selIds.size && fresh.some((e) => e.kind === 'motion' && selIds.has(e.clipId))) return { kind: 'experimenting-motion', clipIds: [...selIds], why: 'You have been shaping how this moves.' };
  if (selIds.size && fresh.some((e) => e.kind === 'effect' && selIds.has(e.clipId))) return { kind: 'searching-look', clipIds: [...selIds], why: 'You have been trying looks on this.' };
  return idle;
}
