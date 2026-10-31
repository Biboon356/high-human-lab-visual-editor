// Controlled randomisation: a pure function of (base chain, options, seed). The same inputs always give the same chain, so a saved
// seed reproduces a result exactly. Every result goes through validateChain, so nothing out of range can reach a clip.
//
// What a roll may do, scaled by `strength` (0 = change nothing, 1 = wild):
//   nudge parameters inside their safe window, flip toggles, pick other options, shift colours
//   add an effect, remove one, swap two neighbours
// What it never touches: locked effects (never changed, removed or swapped), locked parameters, parameters marked fixed in effect-meta.js,
// parameters that already have keyframes (a keyframe would override the new value anyway), and effects that are not addable.
import { EFFECTS, WET } from '../effects-defs.js';
import { rng, childSeed, nudge, pick, pickWeighted } from './rng.js';
import { EFFECT_META, addableTypes, isHeavy, isPinnedEnd, mutationRange, paramOverride, isParamFixed, supportsWet, WET_RANGE } from './effect-meta.js';
import { validateChain, composeChain, newItem, normalizeHex, snapNumber } from './chain.js';

/** Bumped whenever the same seed would give a different result, so a saved recipe can say it no longer reproduces. */
export const ENGINE_VERSION = 2;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---- colour helpers (a colour moves around the wheel rather than jumping to an unrelated value) ----
function hexToHsl(hex) {
  const h = normalizeHex(hex) || '#000000';
  const n = parseInt(h.slice(1), 16), R = (n >> 16 & 255) / 255, G = (n >> 8 & 255) / 255, B = (n & 255) / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2, d = mx - mn;
  let hue = 0, s = 0;
  if (d > 1e-9) {
    s = d / (1 - Math.abs(2 * l - 1));
    hue = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
    hue *= 60; if (hue < 0) hue += 360;
  }
  return [hue, s, l];
}
function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v) => Math.round(clamp(v + m, 0, 1) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
function shiftColour(r, hex, strength) {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex((h + nudge(r) * 120 * strength + 360) % 360, clamp(s + nudge(r) * 0.3 * strength, 0, 1), clamp(l + nudge(r) * 0.25 * strength, 0.04, 0.96));
}

/** Rolls the parameters of one chain item in place. `touched` collects what moved, for the report. */
function mutateParams(r, item, strength) {
  const defs = EFFECTS[item.type].params;
  const pEach = strength > 0 ? 0.3 + 0.7 * strength : 0;
  for (const d of defs) {
    if (isParamFixed(item.type, d.key) || item.lockedParams?.includes(d.key) || item.keyframes?.[d.key]) continue;
    if (!(r() < pEach)) continue;
    const v = item.params[d.key];
    if (d.kind === 'color') item.params[d.key] = shiftColour(r, v, strength);
    else if (d.options) {
      const allowed = paramOverride(item.type, d.key)?.allow || d.options.map((_, i) => i);
      if (allowed.length > 1 && r() < 0.5 * strength) item.params[d.key] = pick(r, allowed.filter((i) => i !== v));
    } else if (d.toggle) {
      if (r() < 0.3 * strength) item.params[d.key] = v ? 0 : 1;
    } else {
      const [lo, hi] = mutationRange(item.type, d);
      item.params[d.key] = clamp(v + nudge(r) * (hi - lo) * strength * 0.6, lo, hi);
    }
  }
  // wet / dry: a gentler or stronger dose of the whole effect, for effects that have no Mix of their own
  if (supportsWet(item.type) && !item.lockedParams?.includes('wet') && !item.keyframes?.wet && r() < pEach * 0.35) {
    const w = snapNumber(WET, clamp((item.wet ?? 1) + nudge(r) * 0.65 * strength, WET_RANGE[0], WET_RANGE[1]));
    if (w >= 0.98) delete item.wet; else item.wet = w;
  }
}

/** Types a roll may insert right now, with weights. Respects the pool, duplicates, exclusive groups, the heavy budget and bias. */
function candidates(chain, { pool, bias, maxHeavy, allowDuplicates }) {
  const present = new Set(chain.map((c) => c.type));
  const groups = new Set(chain.map((c) => EFFECT_META[c.type]?.exclusive).filter(Boolean));
  const heavy = chain.filter((c) => isHeavy(c.type)).length;
  return pool
    .filter((t) => EFFECT_META[t]?.addable && EFFECTS[t])
    .filter((t) => allowDuplicates || !present.has(t))
    .filter((t) => !EFFECT_META[t].exclusive || !groups.has(EFFECT_META[t].exclusive))
    .filter((t) => !isHeavy(t) || heavy < maxHeavy)
    .map((t) => {
      const meta = EFFECT_META[t];
      const w = 1 + [...meta.tags, meta.category].reduce((s, k) => s + (bias[k] || 0), 0);
      return [t, w];
    });
}

/**
 * @param base  chain (see chain.js); may be empty
 * @param o     {seed (required), strength=0.4, pool, bias:{tagOrCategory: weight}, minLength=1, maxLength=6, maxHeavy=1, allowDuplicates=false}
 * @returns {{chain, seed, report:{added:string[], removed:string[], swapped:number, changed:{type,key,from,to}[], dropped:object[]}, issues}}
 *          `issues` lists what validateChain had to repair in the BASE chain (empty for a sound one)
 */
export function mutate(base, o = {}) {
  if (o.seed === undefined || o.seed === null) throw new Error('mutate needs a seed (use newSeed() for a fresh roll, or a saved seed to reproduce one)');
  const { seed } = o;
  const strength = clamp(Number.isFinite(o.strength) ? o.strength : 0.4, 0, 1);
  const bias = o.bias || {};
  const pool = (o.pool || addableTypes()).filter((t) => EFFECTS[t]);
  const r = rng(seed);

  const validated = validateChain(base);
  const chain = validated.chain;
  // a roll never cuts a chain the user built down to the budget: the budget only limits what the roll itself adds
  const minLength = Math.max(0, o.minLength ?? 1);
  const maxLength = Math.max(minLength, o.maxLength ?? 6, chain.length);
  const maxHeavy = Math.max(o.maxHeavy ?? 1, chain.filter((c) => isHeavy(c.type)).length);
  const allowDuplicates = !!o.allowDuplicates || new Set(chain.map((c) => c.type)).size < chain.length;
  const before = new Map(chain.map((c) => [c, { ...c.params, wet: c.wet ?? 1 }]));
  const report = { added: [], removed: [], swapped: 0, changed: [], dropped: [] };

  for (const item of chain) if (!item.locked) mutateParams(r, item, strength);

  // remove (an effect with a locked parameter or animation stays: removing it would throw that work away)
  for (let i = chain.length - 1; i >= 0 && chain.length > minLength; i--) {
    if (!chain[i].locked && !chain[i].lockedParams?.length && !Object.keys(chain[i].keyframes || {}).length && r() < 0.25 * strength) { report.removed.push(chain[i].type); before.delete(chain[i]); chain.splice(i, 1); }
  }
  // add: up to two tries per roll at strength-scaled odds, plus as many forced adds as the minimum length needs
  const tryAdd = () => {
    if (chain.length >= maxLength) return false;
    const list = candidates(chain, { pool, bias, maxHeavy, allowDuplicates });
    const type = pickWeighted(r, list);
    if (!type) return false;
    const item = newItem(type);
    mutateParams(r, item, Math.max(strength, 0.5));
    chain.splice(Math.floor(r() * (chain.length + 1)), 0, item);
    report.added.push(type);
    return true;
  };
  if (r() < 0.6 * strength) tryAdd();
  if (r() < 0.3 * strength) tryAdd();
  while (chain.length < minLength && tryAdd());

  // swap two neighbours that are both free to move (not locked, not pinned to the end)
  if (chain.length > 1 && r() < 0.4 * strength) {
    const slots = [];
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i], b = chain[i + 1];
      if (!a.locked && !b.locked && !isPinnedEnd(a.type) && !isPinnedEnd(b.type)) slots.push(i);
    }
    if (slots.length) { const i = pick(r, slots); [chain[i], chain[i + 1]] = [chain[i + 1], chain[i]]; report.swapped = 1; }
  }

  const composed = composeChain(chain, { maxLength, maxHeavy, allowDuplicates });
  report.dropped = composed.dropped;
  for (const item of composed.chain) {
    const was = before.get(item);
    if (!was) continue;
    for (const d of [...EFFECTS[item.type].params, WET]) {
      const now = d.key === 'wet' ? item.wet ?? 1 : item.params[d.key];
      if (was[d.key] !== now) report.changed.push({ type: item.type, key: d.key, from: was[d.key], to: now });
    }
  }
  const final = validateChain(composed.chain);
  return { chain: final.chain, seed, report, issues: validated.issues };
}

/**
 * A fresh chain from nothing. `length` defaults to 2..4 effects.
 * @param o same options as mutate (minus `minLength`), plus length
 */
export function generate(o = {}) {
  if (o.seed === undefined || o.seed === null) throw new Error('generate needs a seed');
  const n = Math.max(1, o.length ?? 2 + Math.floor(rng(childSeed(o.seed, 'length'))() * 3));
  return mutate([], { strength: 0.6, ...o, minLength: n, maxLength: Math.max(n, o.maxLength ?? 6) });
}

/**
 * `count` different variations of a base chain from one master seed. Variation i always uses the same child seed, so the grid
 * is reproducible; duplicates of an earlier variation (or of the base) are re-rolled from a further child seed.
 * @returns {{seed:number, chain, report}[]}
 */
export function variations(base, { count = 6, seed, ...o } = {}) {
  if (seed === undefined || seed === null) throw new Error('variations needs a master seed');
  const out = [], seen = new Set([JSON.stringify(validateChain(base).chain)]);
  for (let i = 0; i < count; i++) {
    let v = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const s = childSeed(seed, i + attempt * count);
      v = base?.length ? mutate(base, { ...o, seed: s }) : generate({ ...o, seed: s });
      if (!seen.has(JSON.stringify(v.chain))) break;
    }
    seen.add(JSON.stringify(v.chain));
    out.push({ seed: v.seed, chain: v.chain, report: v.report });
  }
  return out;
}
