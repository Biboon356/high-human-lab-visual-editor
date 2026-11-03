// STILL HERE: the creative memory of a project. Not undo history, not a trash can: a small curated shelf of fragments the artist can
// bring back — the way a clip MOVED, the way it LOOKED, the way it FELT (its colours), the RHYTHM of a run of cuts.
//
// A memory is lightweight reusable residue, never a copy of the project or of any media: a simplified movement curve, an effect recipe,
// a few colours, a cut pattern. The project stays the source of truth. Pure functions over plain data (the caller supplies `now`);
// the renderer's engine wires them to the store. Fragments live in project.stillHere (saved with the file, outside undo — see store.js).
import { effectsToChain, chainToEffects, validateChain, MAX_CHAIN } from '../mutation/chain.js';
import { chainHash, stableStringify } from '../mutation/dna.js';
import { EFFECTS } from '../effects-defs.js';
import { CLIP_PROPS } from '../params.js';
import { findMedia, uid } from '../project.js';
import { MIN_CLIP, clipEnd } from '../timeline.js';
import { MOTION_KEYS, motionOf, hasMotion } from './observe.js';

export const STILL_SCHEMA = 1;
export const MAX_MEMORIES = 60;
export const MAX_CURATED = 12;
export const KINDS = {
  moved: { title: 'THE WAY IT MOVED', verb: 'movement' },
  looked: { title: 'THE WAY IT LOOKED', verb: 'look' },
  felt: { title: 'THE WAY IT FELT', verb: 'colours' },
  rhythm: { title: 'THE RHYTHM YOU LEFT BEHIND', verb: 'rhythm' },
};

/** What the Curator asks of a lineage before it keeps anything by itself. Deliberately strict: when unsure, it keeps nothing. */
export const CURATE = { minLifetimeMs: 25000, fullLifetimeMs: 90000, minEdits: 3, fullEdits: 8, minScore: 0.5, minChangedParams: 2, minMoveKeys: 3, maxLimit: MAX_CURATED };
const MIN_AMP = { x: 0.05, y: 0.05, scale: 0.08, rotation: 3 };

const r3 = (n) => Math.round(n * 1000) / 1000;
const text = (v, max, fallback = '') => (typeof v === 'string' ? v.trim().slice(0, max) : fallback);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const propDef = (k) => CLIP_PROPS.find((d) => d.key === k);
const clamp = (def, v) => Math.min(def.max, Math.max(def.min, v));
const stripLocks = (chain) => chain.map(({ locked, lockedParams, ...rest }) => rest);
const memSig = (kind, data) => chainHash({ kind, data });

// ---- data from a clip ----

function movedData(motion, duration) {
  const d = Math.max(0.05, duration);
  const tracks = {};
  for (const k of MOTION_KEYS) {
    const keys = [...(motion[k] || [])].sort((a, b) => a.t - b.t);
    if (!keys.length) continue;
    const v0 = keys[0].v;
    tracks[k] = keys.map((q) => ({ u: r3(Math.min(1, Math.max(0, q.t / d))), d: r3(q.v - v0) })); // offsets from the first key, as a fraction of the clip's length
  }
  return { tracks };
}
const felt = (chain) => {
  const seen = new Set(), colors = [];
  for (const it of chain) for (const p of EFFECTS[it.type]?.params || []) {
    if (p.kind !== 'color') continue;
    const v = it.params?.[p.key];
    if (typeof v === 'string' && !seen.has(v)) { seen.add(v); colors.push(v); }
  }
  return colors.slice(0, 6);
};
const changedParams = (chain) => {
  let n = 0;
  for (const it of chain) {
    if (it.enabled === false) continue;
    for (const p of EFFECTS[it.type]?.params || []) { const v = it.params?.[p.key]; if (v !== undefined && (typeof v === 'number' ? Math.abs(v - p.def) > 1e-6 : v !== p.def)) n++; }
    n += Object.values(it.keyframes || {}).filter((k) => k?.length).length + Object.keys(it.bindings || {}).length;
  }
  return n;
};
const amplitude = (tracks) => Math.max(0, ...Object.entries(tracks).map(([k, keys]) => { const ds = keys.map((q) => q.d); return (Math.max(...ds) - Math.min(...ds)) / (MIN_AMP[k] || 1); }));

function build(kind, data, { name, from, source = 'user', now, score = null, why = '' }) {
  return { schema: STILL_SCHEMA, id: uid('mem'), kind, name: text(name, 80) || KINDS[kind].title, source, at: now, from: from || {}, data, thumb: null, sig: memSig(kind, data), ...(score !== null ? { score: r3(score) } : {}), ...(why ? { why: text(why, 160) } : {}) };
}

/**
 * Keeps one fragment of what the clip(s) are doing now. Explicit saves always work when there is something to keep.
 * @param o {kind: 'moved'|'looked'|'felt'|'rhythm', clipIds, now, name?}
 * @returns {{memory}|{reason: string}}
 */
export function captureMemory(project, { kind, clipIds = [], now = 0, name = '', source = 'user' }) {
  if (!KINDS[kind]) return { reason: 'Unknown kind of memory.' };
  const clips = clipIds.map((id) => project.clips.find((c) => c.id === id)).filter(Boolean);
  if (!clips.length) return { reason: 'Select a clip first.' };
  const clip = clips[0];
  const from = { clip: clip.name || clip.type, type: clip.type };
  if (kind === 'moved') {
    const motion = motionOf(clip);
    if (!hasMotion(motion) || Object.values(motion).every((k) => k.length < 2)) return { reason: 'This clip has no movement to keep yet (needs at least two keyframes on position, scale or rotation).' };
    return { memory: build('moved', movedData(motion, clip.duration), { name: name || from.clip, from, source, now }) };
  }
  if (kind === 'looked' || kind === 'felt') {
    const chain = stripLocks(effectsToChain(clip.effects));
    if (!chain.length) return { reason: 'This clip has no effects, so there is no look to keep.' };
    if (kind === 'looked') return { memory: build('looked', { chain: validateChain(chain).chain }, { name: name || from.clip, from, source, now }) };
    const colors = felt(chain);
    if (!colors.length) return { reason: 'No colours to keep. Colour comes from effects such as Gradient Map or Veins.' };
    return { memory: build('felt', { colors }, { name: name || from.clip, from, source, now }) };
  }
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  if (sorted.length < 3) return { reason: 'Select at least three clips on one track (their cuts are the rhythm).' };
  if (new Set(sorted.map((c) => c.trackId)).size > 1) return { reason: 'Select clips that sit on the same track.' };
  const total = sorted.reduce((s, c) => s + c.duration, 0);
  return { memory: build('rhythm', { intervals: sorted.map((c) => r3(c.duration / total)) }, { name: name || `${sorted.length} cuts`, from: { clip: `${sorted.length} cuts`, type: 'cuts' }, source, now }) };
}

// ---- bringing a fragment back (call inside store.mutate: it edits the project in place) ----

/** @returns {{ok: boolean, reason?: string, changed: number, text?: string}} */
export function applyMemory(project, memory, { clipIds = [] } = {}) {
  const none = (reason) => ({ ok: false, reason, changed: 0 });
  const clips = clipIds.map((id) => project.clips.find((c) => c.id === id)).filter(Boolean);
  if (!clips.length) return none('Select a clip to bring it back to.');
  const clip = clips[0];
  const d = memory?.data;
  if (!d) return none('This memory is empty.');

  // movement, look and colours go onto EVERY selected clip at once (a group); each clip is judged on its own
  const each = (verb, one) => {
    let done = 0, changed = 0, reason = null;
    for (const c of clips) { const r = one(c); if (r.ok) { done++; changed += r.n; } else reason ||= r.reason; }
    if (!done) return none(reason || 'Nothing to bring back.');
    const where = `${done} clip${done === 1 ? "" : "s"}`;
    return { ok: true, changed, text: done === 1 && clips.length === 1 ? undefined : `Brought back ${verb} onto ${where}${done < clips.length ? ` (${clips.length - done} could not take it)` : ''}.` };
  };

  if (memory.kind === 'moved') {
    const r = each('how it moved', (c) => {
      if (c.type === 'adjust' || c.type === 'audio') return { ok: false, reason: 'An adjustment layer cannot move. Select a picture, text or shape.' };
      let n = 0;
      c.keyframes ||= {};
      for (const [k, keys] of Object.entries(d.tracks || {})) {
        const def = propDef(k);
        if (!def || !keys?.length) continue;
        const base = c.props?.[k] ?? def.def;
        c.keyframes[k] = keys.map((q) => ({ t: r3(q.u * c.duration), v: clamp(def, base + q.d) }));
        n += keys.length;
      }
      return n ? { ok: true, n } : { ok: false, reason: 'Nothing to bring back.' };
    });
    return r.ok && !r.text ? { ...r, text: `Brought back how it moved onto “${clip.name || clip.type}”.` } : r;
  }
  if (memory.kind === 'looked') {
    const chain = validateChain(d.chain || []).chain;
    if (!chain.length) return none('Nothing to bring back.');
    const r = each('how it looked', (c) => {
      if ((c.effects || []).length + chain.length > MAX_CHAIN) return { ok: false, reason: `That would make more than ${MAX_CHAIN} effects on one clip. Remove one first.` };
      c.effects = [...(c.effects || []), ...chainToEffects(chain)];
      return { ok: true, n: chain.length };
    });
    return r.ok && !r.text ? { ...r, text: `Brought back how it looked onto “${clip.name || clip.type}” (${chain.length} effect${chain.length === 1 ? '' : 's'} added).` } : r;
  }
  if (memory.kind === 'felt') {
    const colors = d.colors || [];
    const r = each('its colours', (c) => {
      let i = 0, n = 0;
      for (const fx of c.effects || []) for (const p of EFFECTS[fx.type]?.params || []) if (p.kind === 'color' && colors.length) { fx.params[p.key] = colors[i++ % colors.length]; n++; }
      return n ? { ok: true, n } : { ok: false, reason: 'This clip has no colour settings to change. Add an effect with colours first.' };
    });
    return r.ok && !r.text ? { ...r, text: `Recoloured ${r.changed} setting${r.changed === 1 ? '' : 's'} on “${clip.name || clip.type}”.` } : r;
  }
  if (memory.kind === 'rhythm') {
    const sorted = [...clips].sort((a, b) => a.start - b.start);
    if (sorted.length < 2) return none('Select at least two clips on one track to give them this rhythm.');
    if (new Set(sorted.map((c) => c.trackId)).size > 1) return none('Select clips that sit on the same track.');
    const first = sorted[0], last = sorted[sorted.length - 1], span = clipEnd(last) - first.start;
    const ids = new Set(sorted.map((c) => c.id));
    if (project.clips.some((c) => c.trackId === first.trackId && !ids.has(c.id) && c.start < clipEnd(last) - 1e-6 && clipEnd(c) > first.start + 1e-6)) return none('Another clip sits between them on that track. Select the whole run.');
    const w = sorted.map((_, i) => d.intervals[i % d.intervals.length]), wsum = w.reduce((s, x) => s + x, 0);
    let at = first.start, n = 0;
    sorted.forEach((c, i) => {
      let dur = Math.max(MIN_CLIP, (span * w[i]) / wsum);
      if (c.type === 'media') { const m = findMedia(project, c.mediaId); if (m?.duration > 0) dur = Math.min(dur, Math.max(MIN_CLIP, (m.duration - c.in) / (c.speed || 1))); } // never past the end of the footage
      if (Math.abs(c.duration - dur) > 1e-3 || Math.abs(c.start - at) > 1e-3) n++;
      c.start = r3(at); c.duration = r3(dur); at += c.duration;
    });
    return n ? { ok: true, changed: n, text: `Gave ${sorted.length} clips the rhythm.` } : none('They already have this rhythm.');
  }
  return none('Unknown kind of memory.');
}

// ---- the shelf ----

/** Repairs one stored memory; null when it cannot be used. */
export function normalizeMemory(m) {
  if (!isObj(m) || !KINDS[m.kind] || typeof m.id !== 'string' || !isObj(m.data)) return null;
  let data;
  if (m.kind === 'moved') {
    const tracks = {};
    for (const [k, keys] of Object.entries(isObj(m.data.tracks) ? m.data.tracks : {})) {
      if (!MOTION_KEYS.includes(k) || !Array.isArray(keys)) continue;
      const ok = keys.filter((q) => q && Number.isFinite(q.u) && Number.isFinite(q.d)).map((q) => ({ u: Math.min(1, Math.max(0, q.u)), d: q.d })).sort((a, b) => a.u - b.u);
      if (ok.length) tracks[k] = ok;
    }
    if (!Object.keys(tracks).length) return null;
    data = { tracks };
  } else if (m.kind === 'looked') {
    const chain = validateChain(m.data.chain || []).chain;
    if (!chain.length) return null;
    data = { chain };
  } else if (m.kind === 'felt') {
    const colors = (Array.isArray(m.data.colors) ? m.data.colors : []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6);
    if (!colors.length) return null;
    data = { colors };
  } else {
    const iv = (Array.isArray(m.data.intervals) ? m.data.intervals : []).filter((x) => Number.isFinite(x) && x > 0).slice(0, 64);
    if (iv.length < 2) return null;
    data = { intervals: iv };
  }
  const thumb = typeof m.thumb === 'string' && m.thumb.startsWith('data:image/jpeg') && m.thumb.length < 60000 ? m.thumb : null;
  return { schema: STILL_SCHEMA, id: text(m.id, 80), kind: m.kind, name: text(m.name, 80) || KINDS[m.kind].title, source: m.source === 'curated' ? 'curated' : 'user',
    at: Number.isFinite(m.at) ? m.at : 0, from: isObj(m.from) ? { clip: text(m.from.clip, 80), type: text(m.from.type, 20) } : {}, data, thumb, sig: memSig(m.kind, data),
    ...(Number.isFinite(m.score) ? { score: m.score } : {}), ...(typeof m.why === 'string' ? { why: text(m.why, 160) } : {}) };
}

/** The project's shelf, repaired on use (a hand-edited or damaged file never breaks anything). */
export function shelfOf(project) {
  if (!Array.isArray(project.stillHere)) project.stillHere = [];
  const clean = project.stillHere.map(normalizeMemory).filter(Boolean);
  if (clean.length !== project.stillHere.length || clean.some((m, i) => m.sig !== project.stillHere[i].sig)) project.stillHere = clean;
  return project.stillHere;
}

/**
 * Puts a memory on the shelf. Identical content is never kept twice. The shelf stays small: what the user kept is never dropped to make
 * room (the answer is "full" instead); what was kept for them goes first, lowest score and oldest.
 * @returns {{added: boolean, existing?: object, reason?: string}}
 */
export function addMemory(project, memory) {
  const shelf = shelfOf(project);
  const m = normalizeMemory(memory);
  if (!m) return { added: false, reason: 'That memory is not valid.' };
  const same = shelf.find((x) => x.sig === m.sig);
  if (same) return { added: false, existing: same, reason: 'Already kept.' };
  if (m.source === 'curated' && shelf.filter((x) => x.source === 'curated').length >= CURATE.maxLimit) {
    const worst = [...shelf].filter((x) => x.source === 'curated').sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || a.at - b.at)[0];
    if ((worst.score ?? 0) >= (m.score ?? 0)) return { added: false, reason: 'Not better than what is already kept.' };
    project.stillHere = shelf.filter((x) => x !== worst);
  }
  if (shelfOf(project).length >= MAX_MEMORIES) {
    const drop = [...project.stillHere].filter((x) => x.source === 'curated').sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || a.at - b.at)[0];
    if (!drop) return { added: false, reason: `Still Here is full (${MAX_MEMORIES}). Let something go first.` };
    project.stillHere = project.stillHere.filter((x) => x !== drop);
  }
  project.stillHere.push(m);
  return { added: true, memory: m };
}
export const removeMemory = (project, id) => { const n = (project.stillHere || []).length; project.stillHere = (project.stillHere || []).filter((m) => m.id !== id); return project.stillHere.length < n; };
export function renameMemory(project, id, name) { const m = (project.stillHere || []).find((x) => x.id === id); if (!m) return false; m.name = text(name, 80) || m.name; return true; }
export function attachThumb(project, id, dataUrl) { const m = (project.stillHere || []).find((x) => x.id === id); if (!m || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/jpeg') || dataUrl.length >= 60000) return false; m.thumb = dataUrl; return true; }

// ---- the Curator ----

/**
 * Should the engine keep this ended piece of work by itself? Conservative on every count; any doubt means no.
 * @param ended Observer's ended lineage; @param o {now, known: Set of hashes the project or the built-in looks already hold}
 * @returns {{keep: object|null, score: number, why: string}} why = one short sentence either way
 */
export function curate(ended, { now = 0, known = new Set() } = {}) {
  const no = (why, score = 0) => ({ keep: null, score, why });
  const life = (ended.at ?? now) - ended.born;
  const score = 0.5 * Math.min(1, life / CURATE.fullLifetimeMs) + 0.5 * Math.min(1, ended.edits / CURATE.fullEdits);
  if (life < CURATE.minLifetimeMs) return no('It was only there for a moment.', score);
  if (ended.edits < CURATE.minEdits) return no('It was not explored or changed much.', score);
  if (score < CURATE.minScore) return no('Not enough time and care went into it.', score);
  const from = { clip: ended.clipName, type: ended.clipType };
  let kind, data, why;
  if (ended.kind === 'look') {
    const chain = stripLocks(ended.data || []);
    const live = chain.filter((c) => c.enabled !== false);
    if (!live.length) return no('Nothing in it was switched on.', score);
    if (changedParams(live) < CURATE.minChangedParams) return no('It stayed close to the defaults.', score);
    if (known.has(chainHash(chain))) return no('The project (or a built-in look) already has it.', score);
    kind = 'looked'; data = { chain: validateChain(chain).chain }; why = 'You worked on this look for a while before letting it go.';
  } else {
    const d = movedData(ended.data || {}, ended.duration || 1);
    const keys = Object.values(d.tracks).reduce((s, k) => s + k.length, 0);
    if (keys < CURATE.minMoveKeys) return no('Too few keyframes to be a movement.', score);
    if (amplitude(d.tracks) < 1) return no('The movement was too small to matter.', score);
    kind = 'moved'; data = d; why = 'You shaped this movement for a while before letting it go.';
  }
  if (known.has(memSig(kind, data))) return no('Already kept.', score);
  return { keep: build(kind, data, { name: ended.clipName, from, source: 'curated', now, score, why }), score, why };
}

/** Hashes of everything that should not be kept again: chains already on clips, extra hashes the caller knows (built-in looks), and the shelf. */
export function knownHashes(project, extra = []) {
  const s = new Set(extra);
  for (const c of project.clips) if ((c.effects || []).length) s.add(chainHash(stripLocks(effectsToChain(c.effects))));
  for (const m of project.stillHere || []) s.add(m.sig);
  return s;
}
export { stableStringify };
