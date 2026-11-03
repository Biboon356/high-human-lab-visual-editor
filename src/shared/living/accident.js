// Lab Accident: unexpected relationships BETWEEN clips that already exist — not more random effects (Mutate does that).
// Every accident is a small, named change made only with the project's ordinary structures (keyframes, audio bindings, a mask, an
// adjustment layer, an effect). It never deletes or overwrites anything the user made: it only adds, and skips what would clash.
// An accident is planned as a closure over clip ids: apply(project) can run on a clone for a preview and on the real project for Keep.
// Deterministic: the same project, selection and seed give the same accidents.
import { createEffect } from './../effects-defs.js';
import { createClip, defaultProps } from '../project.js';
import { createMask } from '../mask.js';
import { CLIP_PROPS } from '../params.js';
import { addTrack, addClipRaw } from '../timeline.js';
import { rng, childSeed, between, pick, toSeed } from '../mutation/rng.js';

export const ACCIDENT_KINDS = ['memory-cut', 'spread', 'borrow-motion', 'mask-leak', 'unstable'];
const VISUAL = new Set(['media', 'text', 'shape', 'generator']);
const MOTION_KEYS = ['x', 'y', 'scale', 'rotation'];
const end = (c) => c.start + c.duration;
const label = (c) => `“${c.name || c.type}”`;

/** How the clips on screen relate: cuts (one ends where the next begins, same track) and overlaps (one starts inside another, upper above lower). */
export function relations(project) {
  const order = new Map(project.tracks.map((t, i) => [t.id, i]));
  const video = new Set(project.tracks.filter((t) => t.kind === 'video' && !t.hidden).map((t) => t.id));
  const clips = project.clips.filter((c) => VISUAL.has(c.type) && video.has(c.trackId) && !(c.type === 'media' && c.mediaId && project.media.find((m) => m.id === c.mediaId)?.kind === 'audio'));
  const cuts = [], overlaps = [];
  for (const a of clips) for (const b of clips) {
    if (a === b) continue;
    if (a.trackId === b.trackId) { const gap = b.start - end(a); if (b.start > a.start && gap >= -0.05 && gap <= 0.6) cuts.push({ a: a.id, b: b.id, at: b.start }); }
    else if (order.get(a.trackId) < order.get(b.trackId) && a.start >= b.start && a.start < end(b) - 0.8) {
      const len = Math.min(end(a), end(b)) - a.start;
      if (len >= 0.8) overlaps.push({ upper: a.id, lower: b.id, at: a.start, len });
    }
  }
  return { clips, cuts, overlaps };
}

const byId = (p, id) => p.clips.find((c) => c.id === id);
const spanOf = (key) => { const d = CLIP_PROPS.find((x) => x.key === key); return d ? d.max - d.min : 1; };
const motionKeys = (c) => MOTION_KEYS.filter((k) => (c.keyframes?.[k] || []).length >= 2);

// ---- the five accidents: each builder returns {kind, title, summary, at, clipIds, preview, apply} or null when it does not fit ----

export function memoryCut(project, rel, r) {
  const { a, b, at } = rel;
  const A = byId(project, a), B = byId(project, b);
  const mode = pick(r, [0, 0, 3, 1]), length = Math.round(between(r, 1.1, 2) * 20) / 20;
  const start = Math.max(0, at - 0.3), dur = 0.3 + length + 0.6;
  return { kind: 'memory-cut', title: 'The cut remembers', preview: 'playback', at, clipIds: [a, b],
    summary: `The last moment of ${label(A)} bleeds into ${label(B)} for about ${length} s after the cut (${['Ghost', 'Stain', 'Scar', 'Echo'][mode]}).`,
    apply(p) {
      if (!byId(p, a) || !byId(p, b)) return false;
      const fx = createEffect('memory', { mode, length, intensity: 1, blend: 4, decay: 0.5, rate: 3 });
      // it builds up from the first moment of the layer, but only shows from the cut on, then lets go
      fx.keyframes.intensity = [{ t: 0, v: 0 }, { t: Math.round((at - start) * 1000) / 1000, v: 1 }, { t: Math.round(dur * 1000) / 1000, v: 0 }];
      const layer = createClip({ type: 'adjust', name: `Accident · the cut remembers`, start, duration: dur, props: defaultProps(), effects: [fx] });
      layer.trackId = addTrack(p, 'video').id; addClipRaw(p, layer);
      return true;
    } };
}

export function spread(project, rel, r, ctx) {
  const { a, b, at } = rel;
  const A = byId(project, a), B = byId(project, b);
  const own = [A, B].map((c) => c.effects.find((e) => e.type === 'veins')).find(Boolean);
  const seed = Math.floor(r() * 99), color = own?.params.color || ctx.palette?.[0] || pick(r, ['#7dffb0', '#ff4fd8', '#ffd27d', '#9fc2ff']);
  const reach = Math.round(between(r, 1.2, 2.2) * 10) / 10;
  return { kind: 'spread', title: 'It spreads across the cut', preview: 'static', at, clipIds: [a, b],
    summary: `Organic growth creeps up at the end of ${label(A)}, carries across the cut into ${label(B)}, then recedes (${reach} s each way).`,
    apply(p) {
      const X = byId(p, a), Y = byId(p, b);
      if (!X || !Y) return false;
      const mk = () => { const v = createEffect('veins', { mode: 0, origin: 5, density: ctx.organic?.density ?? 2.6, thickness: ctx.organic?.thickness ?? 0.14, glow: 1, cling: 0.6, seed, color, mix: 1 }); v.bindings.glow = { source: 'bass', amount: 0.3 }; return v; }; // the growth breathes with the bass once the music is analysed
      const vx = mk(), vy = mk();
      vx.keyframes.growth = [{ t: Math.max(0, Math.round((X.duration - reach) * 1000) / 1000), v: 0 }, { t: Math.round(X.duration * 1000) / 1000, v: 0.9 }];
      vy.keyframes.growth = [{ t: 0, v: 0.9 }, { t: Math.round(Math.min(reach, Y.duration) * 1000) / 1000, v: 0 }];
      X.effects.push(vx); Y.effects.push(vy);
      return true;
    } };
}

export function borrowMotion(project, rel, r) {
  const { from, to } = rel;
  const A = byId(project, from), B = byId(project, to);
  const keys = motionKeys(A).filter((k) => !(B.keyframes?.[k] || []).length);
  if (!keys.length) return null;
  const f = Math.round(between(r, 0.3, 0.7) * 100) / 100;
  return { kind: 'borrow-motion', title: 'It moves like the other one', preview: 'static', at: B.start, clipIds: [from, to],
    summary: `${label(B)} inherits ${Math.round(f * 100)}% of the movement (${keys.join(', ')}) of ${label(A)}.`,
    apply(p) {
      const X = byId(p, from), Y = byId(p, to);
      if (!X || !Y) return false;
      let n = 0;
      for (const k of keys) {
        if ((Y.keyframes?.[k] || []).length) continue; // never replaces motion the user already made
        const src = X.keyframes[k], def = CLIP_PROPS.find((d) => d.key === k), v0 = src[0].v, base = Y.props[k] ?? def.def;
        Y.keyframes ||= {};
        Y.keyframes[k] = src.map((q) => ({ t: Math.round((q.t / Math.max(0.01, X.duration)) * Y.duration * 1000) / 1000, v: Math.min(def.max, Math.max(def.min, base + (q.v - v0) * f)) }));
        n++;
      }
      return n > 0;
    } };
}

function maskLeak(project, rel, r) {
  const { upper, lower, at } = rel;
  const U = byId(project, upper), L = byId(project, lower);
  if (U.mask) return null; // a mask the user made is left alone
  const cx = Math.round(between(r, 0.3, 0.7) * 100) / 100, cy = Math.round(between(r, 0.35, 0.65) * 100) / 100;
  return { kind: 'mask-leak', title: 'A window opens', preview: 'static', at, clipIds: [upper, lower],
    summary: `${label(U)} opens like an iris over ${label(L)}, from a point near the middle, over its first second and a half.`,
    apply(p) {
      const X = byId(p, upper);
      if (!X || X.mask) return false;
      X.mask = createMask('ellipse', { cx, cy, w: 0.5, h: 0.5 });
      X.props.maskFeather = 0.35;
      X.keyframes ||= {};
      if (!(X.keyframes.maskScale || []).length) X.keyframes.maskScale = [{ t: 0, v: 0.1 }, { t: Math.min(1.5, X.duration), v: 1.6 }];
      return true;
    } };
}

function unstable(project, rel, r) {
  const ids = rel.ids;
  const clips = ids.map((i) => byId(project, i));
  const src = pick(r, ['bass', 'beat']), key = pick(r, ['scale', 'rotation', 'x']);
  const amt = Math.round(({ scale: between(r, 0.012, 0.03), rotation: between(r, 0.003, 0.008), x: between(r, 0.01, 0.03) })[key] * 1e4) / 1e4;
  const free = clips.filter((c) => !c.bindings?.[key]);
  if (!free.length) return null;
  return { kind: 'unstable', title: 'Unstable on the music', preview: 'playback', at: Math.max(...clips.map((c) => c.start)), clipIds: ids,
    summary: clips.length > 1 ? `${label(clips[0])} and ${label(clips[1])} ${key === 'x' ? 'sway' : key === 'rotation' ? 'tilt' : 'breathe'} against each other with the ${src} (needs the music analysed).` : `${label(clips[0])} ${key === 'x' ? 'sways' : key === 'rotation' ? 'tilts' : 'breathes'} with the ${src} (needs the music analysed).`,
    apply(p) {
      let n = 0;
      ids.forEach((id, i) => { const c = byId(p, id); if (!c || c.bindings?.[key]) return; c.bindings ||= {}; c.bindings[key] = { source: src, amount: i % 2 ? -amt : amt }; n++; });
      return n > 0;
    } };
}

/** Several plans of one kind become ONE plan that applies them all (a group: the same accident at every place at once). */
export function combinePlans(plans) {
  if (plans.length === 1) return plans[0];
  const [first] = plans;
  return { ...first, title: `${first.title} ×${plans.length}`,
    summary: `${first.summary} The same happens at ${plans.length - 1} more place${plans.length === 2 ? '' : 's'}.`,
    clipIds: [...new Set(plans.flatMap((a) => a.clipIds))], at: Math.min(...plans.map((a) => a.at)),
    preview: plans.some((a) => a.preview === 'playback') ? 'playback' : 'static',
    apply(p) { let n = 0; for (const a of plans) if (a.apply(p)) n++; return n > 0; } };
}

const GROUP_MAX = 12;

/**
 * Plans up to `count` accidents of different kinds for the project as it is.
 *
 * WHERE: with two or more clips selected, the accidents work on the selection as a GROUP (every cut and overlap between the selected
 * clips, and "unstable" on all of them at once, as one accident). Otherwise, when `at` (the playhead, in seconds) is given, only on the
 * cuts and overlaps within `window` seconds of it, so nothing happens somewhere else; without `at`, anywhere in the project.
 * @param o {seed (required), selection: clip ids, count=3, kinds: limit to these kinds, identity: a Project DNA identity (colours), at, window=1.5}
 * @returns [{id, kind, seed, title, summary, at, clipIds, preview: 'static'|'playback', apply(project) → boolean}]
 */
export function planAccidents(project, { seed, selection = [], count = 3, kinds = ACCIDENT_KINDS, identity = null, at = null, window: win = 1.5 } = {}) {
  if (seed === undefined || seed === null) throw new Error('planAccidents needs a seed');
  const all = relations(project), sel = new Set(selection), ctx = { palette: identity?.palette, organic: identity?.organic };
  const group = selection.length >= 2;
  let rel = all;
  if (group) rel = { clips: all.clips, cuts: all.cuts.filter((x) => sel.has(x.a) && sel.has(x.b)), overlaps: all.overlaps.filter((x) => sel.has(x.upper) && sel.has(x.lower)) };
  else if (Number.isFinite(at)) rel = { clips: all.clips, cuts: all.cuts.filter((x) => Math.abs(x.at - at) <= win), overlaps: all.overlaps.filter((x) => at >= x.at - win && at <= x.at + x.len + win) };
  const prefer = (list, ids) => { const hit = list.filter((x) => ids(x).some((i) => sel.has(i))); return hit.length ? hit : list; };
  const r0 = rng(seed);
  const order = [...kinds].filter((k) => ACCIDENT_KINDS.includes(k)).map((k) => [k, r0()]).sort((x, y) => x[1] - y[1]).map(([k]) => k);
  const many = (list, make) => list.slice(0, GROUP_MAX).map(make).filter(Boolean);
  const out = [];
  for (const kind of order) {
    if (out.length >= count) break;
    const r = rng(childSeed(seed, kind));
    let acc = null;
    if (group) {
      let list = [];
      if (kind === 'memory-cut') list = many(rel.cuts, (x) => memoryCut(project, x, r));
      else if (kind === 'spread') list = many(rel.cuts, (x) => spread(project, x, r, ctx));
      else if (kind === 'borrow-motion') list = many([...rel.cuts.map((x) => ({ from: x.a, to: x.b })), ...rel.overlaps.map((x) => ({ from: x.lower, to: x.upper }))], (x) => borrowMotion(project, x, r));
      else if (kind === 'mask-leak') list = many(rel.overlaps.filter((x) => !byId(project, x.upper).mask), (x) => maskLeak(project, x, r));
      else if (kind === 'unstable') { const ids = selection.filter((i) => rel.clips.some((c) => c.id === i)); const u = ids.length ? unstable(project, { ids }, r) : null; if (u) list = [u]; }
      if (list.length) acc = combinePlans(list);
    } else if (kind === 'memory-cut' || kind === 'spread') {
      const list = prefer(rel.cuts, (x) => [x.a, x.b]);
      if (list.length) acc = (kind === 'memory-cut' ? memoryCut : spread)(project, pick(r, list), r, ctx);
    } else if (kind === 'borrow-motion') {
      const pairs = [...rel.cuts.map((x) => ({ from: x.a, to: x.b })), ...rel.cuts.map((x) => ({ from: x.b, to: x.a })), ...rel.overlaps.map((x) => ({ from: x.lower, to: x.upper })), ...rel.overlaps.map((x) => ({ from: x.upper, to: x.lower }))]
        .filter((x) => motionKeys(byId(project, x.from)).some((k) => !(byId(project, x.to).keyframes?.[k] || []).length));
      if (pairs.length) acc = borrowMotion(project, pick(r, prefer(pairs, (x) => [x.from, x.to])), r);
    } else if (kind === 'mask-leak') {
      const list = prefer(rel.overlaps.filter((x) => !byId(project, x.upper).mask), (x) => [x.upper, x.lower]);
      if (list.length) acc = maskLeak(project, pick(r, list), r);
    } else if (kind === 'unstable') {
      const pairs = [...rel.cuts.map((x) => [x.a, x.b]), ...rel.overlaps.map((x) => [x.upper, x.lower])];
      // one selected clip is enough; with a cursor it must be on screen there
      const here = (i) => { const c = byId(project, i); return rel.clips.some((q) => q.id === i) && (!Number.isFinite(at) || (c.start - win <= at && at <= c.start + c.duration + win)); };
      const ids = pairs.length ? pick(r, prefer(pairs, (x) => x)) : selection.filter(here).slice(0, 1);
      if (ids.length) acc = unstable(project, { ids }, r);
    }
    if (acc) out.push({ id: `${kind}:${toSeed(`${seed}/${acc.clipIds.join('/')}`).toString(36)}`, seed, ...acc });
  }
  return out;
}
