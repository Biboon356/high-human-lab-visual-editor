// The Living Timeline: four ways to let one clip relate to another, in the artist's words.
//
//   FOLLOW     let one thing respond to another        → it moves the way the other moves (or breathes with the same music)
//   GROW FROM  let one thing emerge from another       → growth creeps out of the first and carries across the cut
//   REMEMBER   let one thing carry traces of another   → the end of the first bleeds into the second
//   BECOME     let one thing gradually transform into another → the first one's look and position glide into the second's
//
// Nothing here is a new system. FOLLOW, GROW FROM and REMEMBER are the builders Lab Accident already uses (shared/living/accident.js);
// BECOME only writes ordinary keyframes (effect settings, wet/dry, clip position). A plan is a closure over clip ids: apply(project) can
// run on a clone for a preview and on the real project for APPLY (one undo step). It only ever adds; it skips what would clash, and
// never replaces keyframes or bindings the artist made.
import { createEffect, EFFECTS } from '../effects-defs.js';
import { CLIP_PROPS } from '../params.js';
import { effectsToChain, MAX_CHAIN } from '../mutation/chain.js';
import { supportsWet } from '../mutation/effect-meta.js';
import { rng, childSeed, toSeed } from '../mutation/rng.js';
import { memoryCut, spread, borrowMotion } from '../living/accident.js';
import { MOTION_KEYS } from './observe.js';

export const RELATIONS = [
  { key: 'follow', title: 'FOLLOW', line: 'Let one thing respond to another.' },
  { key: 'grow', title: 'GROW FROM', line: 'Let one thing emerge from another.' },
  { key: 'remember', title: 'REMEMBER', line: 'Let one thing carry traces of another.' },
  { key: 'become', title: 'BECOME', line: 'Let one thing gradually transform into another.' },
];
export const relationOf = (key) => RELATIONS.find((r) => r.key === key);

const VISUAL = new Set(['media', 'text', 'shape', 'generator']);
const byId = (p, id) => p.clips.find((c) => c.id === id);
const r3 = (n) => Math.round(n * 1000) / 1000;
const label = (c) => `“${c.name || c.type}”`;
const isPicture = (project, c) => c && VISUAL.has(c.type) && !(c.type === 'media' && project.media.find((m) => m.id === c.mediaId)?.kind === 'audio');
const propDef = (k) => CLIP_PROPS.find((d) => d.key === k);
const hasKeys = (c, k) => (c.keyframes?.[k] || []).length > 0;
const motionKeys = (c) => MOTION_KEYS.filter((k) => (c.keyframes?.[k] || []).length >= 2);

/** The two clips in the order the relation runs: the earlier one is the source, the later one the target. */
export function orderPair(project, aId, bId) {
  const a = byId(project, aId), b = byId(project, bId);
  if (!a || !b || a === b) return null;
  const rank = new Map(project.tracks.map((t, i) => [t.id, i]));
  // the earlier start comes first; on a tie the lower track (further from the viewer) is the source
  const [from, to] = a.start < b.start || (a.start === b.start && rank.get(a.trackId) > rank.get(b.trackId)) ? [a, b] : [b, a];
  return { from, to };
}

// ---- FOLLOW ----

function follow(project, A, B, r) {
  const motion = borrowMotion(project, { from: A.id, to: B.id }, r);
  if (motion) return { ...motion, kind: 'follow' };
  // no movement to borrow: follow the same music instead (the same audio bindings the other one has)
  const keys = Object.keys(A.bindings || {}).filter((k) => !B.bindings?.[k] && propDef(k));
  if (!keys.length) return null;
  return { kind: 'follow', preview: 'playback', at: B.start, clipIds: [A.id, B.id],
    summary: `${label(B)} follows the same music as ${label(A)} (${keys.join(', ')}). It shows while the timeline plays, once the music is analysed.`,
    apply(p) {
      const X = byId(p, A.id), Y = byId(p, B.id);
      if (!X || !Y) return false;
      let n = 0;
      for (const k of keys) { if (Y.bindings?.[k] || !X.bindings?.[k]) continue; Y.bindings ||= {}; Y.bindings[k] = { ...X.bindings[k] }; n++; }
      return n > 0;
    } };
}

// ---- BECOME ----

function become(project, A, B) {
  const span = Math.round(Math.min(1.5, Math.max(0.4, B.duration * 0.5)) * 20) / 20;
  const endOf = (k) => { const ks = A.keyframes?.[k]; return ks?.length ? ks[ks.length - 1].v : (A.props?.[k] ?? propDef(k).def); };
  const glide = MOTION_KEYS.filter((k) => !hasKeys(B, k) && Math.abs(endOf(k) - (B.props?.[k] ?? propDef(k).def)) > (propDef(k).max - propDef(k).min) * 0.01);
  const aTypes = new Set(A.effects.map((e) => e.type)), bTypes = new Set(B.effects.map((e) => e.type));
  if (!A.effects.length && !B.effects.length && !glide.length) return null;
  return { kind: 'become', preview: 'playback', at: B.start, clipIds: [A.id, B.id],
    summary: `${label(A)} becomes ${label(B)}: over the first ${span} s, ${label(B)} starts where ${label(A)} ended (${[glide.length ? 'its position' : '', aTypes.size || bTypes.size ? 'its look' : ''].filter(Boolean).join(' and ')}) and settles into its own.`,
    apply(p) {
      const X = byId(p, A.id), Y = byId(p, B.id);
      if (!X || !Y) return false;
      let n = 0;
      const own = [...Y.effects];
      for (const fa of X.effects) {
        const fb = own.find((e) => e.type === fa.type);
        if (fb) { // the same effect on both: its settings glide from the first one's to the second one's
          for (const d of EFFECTS[fa.type].params) {
            if (d.kind === 'color' || d.options || d.toggle || typeof fa.params[d.key] !== 'number' || typeof fb.params[d.key] !== 'number') continue;
            if ((fb.keyframes[d.key] || []).length || fb.bindings?.[d.key] || Math.abs(fa.params[d.key] - fb.params[d.key]) <= (d.max - d.min) * 0.02) continue;
            fb.keyframes[d.key] = [{ t: 0, v: fa.params[d.key] }, { t: span, v: fb.params[d.key] }]; n++;
          }
        } else if (supportsWet(fa.type) && Y.effects.length < MAX_CHAIN) { // an effect only the first one had lingers for a moment and lets go
          const c = createEffect(fa.type, { ...fa.params });
          c.keyframes.wet = [{ t: 0, v: 1 }, { t: span, v: 0 }];
          Y.effects.push(c); n++;
        }
      }
      for (const fb of own) { // an effect only the second one has fades in
        if (!aTypes.has(fb.type) && supportsWet(fb.type) && !(fb.keyframes.wet || []).length && !fb.bindings?.wet && !(fb.wet < 1)) { fb.keyframes.wet = [{ t: 0, v: 0 }, { t: span, v: 1 }]; n++; }
      }
      for (const k of glide) { // position, size and turn start where the first one ended
        const def = propDef(k), base = Y.props?.[k] ?? def.def;
        Y.keyframes ||= {}; Y.keyframes[k] = [{ t: 0, v: Math.min(def.max, Math.max(def.min, endOf(k))) }, { t: span, v: base }]; n++;
      }
      return n > 0;
    } };
}

const WORDS = {
  follow: ['It moves like the other one', 'Neither clip has movement (or music bindings) to follow.'],
  grow: ['It grows out of the other one', 'Growth cannot be planned for these two clips.'],
  remember: ['It remembers the other one', 'Nothing to carry over for these two clips.'],
  become: ['It becomes the other one', 'Neither clip has a look or a position to carry over.'],
};

/**
 * Plans one relation between two clips. Changes nothing.
 * @param kind 'follow' | 'grow' | 'remember' | 'become'; @param o {seed, identity (Project DNA identity: palette and organic voice)}
 * @returns {{id, relation, title, line, summary, clipIds, at, preview: 'static'|'playback', apply(project) → boolean}|{reason: string}}
 */
export function planRelation(project, kind, aId, bId, { seed = 1, identity = null } = {}) {
  const rel = relationOf(kind);
  if (!rel) return { reason: 'Unknown relation.' };
  const pair = orderPair(project, aId, bId);
  if (!pair) return { reason: 'Select two different clips.' };
  const { from: A, to: B } = pair;
  if (!isPicture(project, A) || !isPicture(project, B)) return { reason: 'Pick two pictures, titles or shapes (not sound).' };
  const r = rng(childSeed(seed, kind)), ctx = { palette: identity?.palette, organic: identity?.organic };
  let plan = null;
  if (kind === 'follow') plan = follow(project, A, B, r);
  else if (kind === 'grow') plan = spread(project, { a: A.id, b: B.id, at: B.start }, r, ctx);
  else if (kind === 'remember') plan = memoryCut(project, { a: A.id, b: B.id, at: B.start }, r);
  else plan = become(project, A, B);
  if (!plan) return { reason: WORDS[kind][1] };
  return { id: `${kind}:${toSeed(`${seed}/${A.id}/${B.id}`).toString(36)}`, relation: kind, seed, from: A.id, to: B.id, ...plan, kind, title: rel.title, line: WORDS[kind][0], summary: plan.summary };
}

/** The same clip chains are compared by suggestions: do two clips already carry the same look? (re-exported for the suggestion rules) */
export const chainOfClip = (c) => effectsToChain(c.effects || []);
export { motionKeys };
