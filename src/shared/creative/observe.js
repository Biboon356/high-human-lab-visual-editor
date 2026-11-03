// Creative Memory Engine, stage 1: OBSERVE. A light, event-driven watcher of what the artist does to the project. It never decides
// anything and never shows anything: it keeps a small index of each clip, and a "lineage" for each clip's look (effect chain) and
// movement (x/y/scale/rotation keyframes) — how long it has been worked on, how many times it was changed — so that when a lineage
// ENDS (the clip was deleted, the effects were cleared or swapped for something else) the engine can ask whether it was worth keeping.
//
// Pure: time is passed in (`now`, milliseconds), nothing is read from the DOM or the clock. update() is meant to be called after a quiet
// moment (the engine debounces), never per frame, and does work proportional to the number of clips.
import { effectsToChain } from '../mutation/chain.js';
import { stableStringify } from '../mutation/dna.js';
import { EFFECTS } from '../effects-defs.js';

export const MOTION_KEYS = ['x', 'y', 'scale', 'rotation'];
const RECENT_MAX = 40;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** The x / y / scale / rotation keyframe tracks of a clip that have at least one key (copied). */
export function motionOf(clip) {
  const out = {};
  for (const k of MOTION_KEYS) {
    const ks = clip.keyframes?.[k];
    if (Array.isArray(ks) && ks.length) out[k] = ks.map(({ t, v }) => ({ t, v }));
  }
  return out;
}
export const hasMotion = (m) => Object.keys(m || {}).length > 0;

/** 0 (same) .. 1 (nothing in common): how far one chain is from another. Moving one slider is small; swapping the look is large. */
export function chainDistance(a, b) {
  const ma = new Map(a.map((i) => [i.type, i])), mb = new Map(b.map((i) => [i.type, i]));
  const types = new Set([...ma.keys(), ...mb.keys()]);
  if (!types.size) return 0;
  let d = 0;
  for (const t of types) {
    const x = ma.get(t), y = mb.get(t);
    if (!x || !y) { d += 1; continue; }
    const keys = Object.keys({ ...x.params, ...y.params });
    let diff = 0;
    for (const k of keys) {
      const p = x.params[k], q = y.params[k];
      if (typeof p === 'number' && typeof q === 'number') {
        const def = EFFECTS[t]?.params.find((z) => z.key === k);
        const span = def ? (def.max - def.min) || 1 : 1;
        if (Math.abs(p - q) / span > 0.1) diff++;
      } else if (p !== q) diff++;
    }
    d += keys.length ? Math.min(1, (diff / keys.length) * 2) : 0; // half of the settings moved = completely different
  }
  return d / types.size;
}

export const REPLACED_DISTANCE = 0.6;

export class Observer {
  constructor() { this.reset(); }

  reset() {
    this.clips = new Map(); // id -> {geo}
    this.look = new Map(); // clipId -> lineage of the effect chain
    this.move = new Map(); // clipId -> lineage of the movement
    this.recent = []; // [{t, kind, clipId}] kinds: added, text, timing, effect, motion, removed
    this.primed = false;
  }

  /**
   * Looks at the project once and reports what changed since the last call.
   * @param silent resync only (after undo, redo or loading a project): nothing counts as an edit and no lineage "ends", because an
   *   undone change was not abandoned work.
   * @returns {{ended: object[], events: object[]}} ended lineages: {kind: 'look'|'move', clipId, clipName, clipType, reason, born, at, edits, duration, data}
   */
  update(project, now, { silent = false } = {}) {
    const quiet = silent || !this.primed;
    this.primed = true;
    const ended = [], events = [];
    const seen = new Set();
    const end = (line, kind, clip, reason) => { if (!quiet) ended.push({ kind, clipId: clip.id, clipName: clip.name || clip.type, clipType: clip.type, reason, born: line.born, at: now, edits: line.edits, duration: line.duration, data: line.last }); };

    for (const clip of project.clips) {
      seen.add(clip.id);
      const geo = `${clip.trackId}|${r3(clip.start)}|${r3(clip.duration)}`;
      const prev = this.clips.get(clip.id);
      if (!quiet) {
        if (!prev) events.push({ t: now, kind: clip.type === 'text' ? 'text' : 'added', clipId: clip.id });
        else if (prev.geo !== geo) events.push({ t: now, kind: 'timing', clipId: clip.id });
      }
      this.clips.set(clip.id, { geo });

      // ---- look lineage
      const chain = effectsToChain(clip.effects || []);
      const sig = stableStringify(chain);
      const line = this.look.get(clip.id);
      if (!chain.length) { if (line) { end(line, 'look', clip, 'cleared'); this.look.delete(clip.id); } }
      else if (!line) { this.look.set(clip.id, { born: now, edits: 0, sig, last: chain, duration: clip.duration }); if (!quiet) events.push({ t: now, kind: 'effect', clipId: clip.id }); }
      else if (line.sig !== sig) {
        if (quiet) Object.assign(line, { sig, last: chain, duration: clip.duration });
        else if (chainDistance(line.last, chain) >= REPLACED_DISTANCE) { end(line, 'look', clip, 'replaced'); this.look.set(clip.id, { born: now, edits: 0, sig, last: chain, duration: clip.duration }); events.push({ t: now, kind: 'effect', clipId: clip.id }); }
        else { Object.assign(line, { sig, last: chain, duration: clip.duration, edits: line.edits + 1 }); events.push({ t: now, kind: 'effect', clipId: clip.id }); }
      }

      // ---- movement lineage
      const motion = motionOf(clip);
      const msig = stableStringify(motion);
      const mline = this.move.get(clip.id);
      if (!hasMotion(motion)) { if (mline) { end(mline, 'move', clip, 'cleared'); this.move.delete(clip.id); } }
      else if (!mline) { this.move.set(clip.id, { born: now, edits: 0, sig: msig, last: motion, duration: clip.duration }); if (!quiet) events.push({ t: now, kind: 'motion', clipId: clip.id }); }
      else if (mline.sig !== msig) {
        if (quiet) Object.assign(mline, { sig: msig, last: motion, duration: clip.duration });
        else { Object.assign(mline, { sig: msig, last: motion, duration: clip.duration, edits: mline.edits + 1 }); events.push({ t: now, kind: 'motion', clipId: clip.id }); }
      }
    }

    // clips that are gone: their lineages end (needs the clip's name, which we no longer have, so it was kept on the line)
    for (const id of [...this.clips.keys()]) {
      if (seen.has(id)) continue;
      this.clips.delete(id);
      const gone = { id, name: this.names?.get(id) || 'a clip', type: this.types?.get(id) || 'media' };
      for (const [map, kind] of [[this.look, 'look'], [this.move, 'move']]) {
        const line = map.get(id);
        if (line) { end(line, kind, { id, name: gone.name, type: gone.type }, 'clip-removed'); map.delete(id); }
      }
      if (!quiet) events.push({ t: now, kind: 'removed', clipId: id });
    }
    this.names = new Map(project.clips.map((c) => [c.id, c.name || c.type]));
    this.types = new Map(project.clips.map((c) => [c.id, c.type]));

    for (const e of events) this.recent.push(e);
    if (this.recent.length > RECENT_MAX) this.recent.splice(0, this.recent.length - RECENT_MAX);
    return { ended, events };
  }
}
