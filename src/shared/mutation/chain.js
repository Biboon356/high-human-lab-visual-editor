// Effect chains as plain data, and the gate every generated or imported chain goes through.
//
// A "chain" is an array of items shaped like an effect instance without its id:
//   { type, enabled, params, keyframes, bindings, locked?, lockedParams? }
// so it converts to and from clip.effects without a second format. `locked` freezes a whole effect: its parameters and on/off state
// never change, a roll never removes or swaps it, and its order relative to other locked effects never changes (effects around it may
// still be added or removed, so its index can move). `lockedParams` freezes single parameters (and keeps the effect from being removed). Locks are data on the item, so they
// save with a DNA.
import { EFFECTS, createEffect } from '../effects-defs.js';
import { REACTIVE_SOURCES } from '../params.js';
import { isHeavy, isPinnedEnd, stageOrder } from './effect-meta.js';

export const MAX_CHAIN = 12;

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const decimals = (step) => { const s = String(step); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };

export function normalizeHex(v) {
  const m = typeof v === 'string' ? HEX.exec(v.trim()) : null;
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return `#${h}`;
}

/** Clamps to the hard range and snaps to the slider step, without float dust (0.1 + 0.2 style). */
export function snapNumber(def, v) {
  const clamped = Math.min(def.max, Math.max(def.min, v));
  if (!(def.step > 0)) return clamped;
  const snapped = def.min + Math.round((clamped - def.min) / def.step) * def.step;
  return Math.min(def.max, Math.max(def.min, Number(snapped.toFixed(Math.max(decimals(def.step), decimals(def.min)) + 2))));
}

/** Makes one parameter value legal for its definition. Returns {value, issue} where issue is a short code or null. */
export function fixParam(def, v) {
  if (def.kind === 'color') { const h = normalizeHex(v); return h ? { value: h, issue: h === v ? null : 'colour-normalised' } : { value: def.def, issue: 'bad-colour' }; }
  if (def.options) {
    if (Number.isInteger(v) && v >= 0 && v < def.options.length) return { value: v, issue: null };
    return { value: def.def, issue: 'bad-option' };
  }
  if (!isNum(v)) return { value: def.def, issue: 'not-a-number' };
  if (def.toggle) return { value: v >= 0.5 ? 1 : 0, issue: v === 0 || v === 1 ? null : 'toggle-snapped' };
  const s = snapNumber(def, v);
  return { value: s, issue: Math.abs(s - v) > 1e-9 * Math.max(1, Math.abs(v)) ? 'clamped' : null };
}

/** Defensive copy of a keyframe track: finite times and values, value clamped, sorted by time. */
function fixTrack(def, keys, path, issues) {
  if (!Array.isArray(keys)) return null;
  const out = [];
  for (const k of keys) {
    if (!k || !isNum(k.t) || !isNum(k.v)) { issues.push({ path, code: 'bad-key', message: 'dropped an invalid keyframe' }); continue; }
    out.push({ t: Math.max(0, k.t), v: snapNumber(def, k.v) });
  }
  out.sort((a, b) => a.t - b.t);
  return out.length ? out : null;
}

/**
 * Validates and repairs a chain. Nothing is mutated; the result is a fresh array.
 *   - unknown effect types are dropped; unknown parameters are dropped; missing parameters get their defaults
 *   - numbers are clamped and snapped, NaN becomes the default, option indices and colours are checked, toggles become 0 or 1
 *   - keyframes keep only finite points; bindings keep only a real source and a numeric parameter
 *   - a chain longer than MAX_CHAIN is cut
 * @returns {{chain: object[], issues: {path:string, code:string, message:string}[]}} issues is empty when the input was already sound
 */
export function validateChain(input) {
  const issues = [];
  const chain = [];
  let cut = false;
  if (!Array.isArray(input)) return { chain, issues: [{ path: '', code: 'not-a-chain', message: 'a chain must be an array' }] };
  input.forEach((item, i) => {
    const at = `[${i}]`;
    const def = item && EFFECTS[item.type];
    if (!def) { issues.push({ path: at, code: 'unknown-effect', message: `unknown effect "${item?.type}"` }); return; }
    if (chain.length >= MAX_CHAIN) { if (!cut) issues.push({ path: at, code: 'too-long', message: `chain cut at ${MAX_CHAIN} effects` }); cut = true; return; }
    const src = item.params && typeof item.params === 'object' ? item.params : {};
    const params = {};
    for (const d of def.params) {
      const { value, issue } = fixParam(d, src[d.key] === undefined ? d.def : src[d.key]);
      params[d.key] = value;
      if (issue && src[d.key] !== undefined) issues.push({ path: `${at}.params.${d.key}`, code: issue, message: `${item.type}.${d.key}: ${issue}` });
    }
    for (const k of Object.keys(src)) if (!def.params.some((d) => d.key === k)) issues.push({ path: `${at}.params.${k}`, code: 'unknown-param', message: `${item.type} has no parameter "${k}"` });

    const keyframes = {}, bindings = {};
    for (const [k, track] of Object.entries(item.keyframes || {})) {
      const d = def.params.find((p) => p.key === k);
      if (!d || d.kind === 'color' || d.options) { issues.push({ path: `${at}.keyframes.${k}`, code: 'bad-track', message: `cannot animate "${k}"` }); continue; }
      const t = fixTrack(d, track, `${at}.keyframes.${k}`, issues);
      if (t) keyframes[k] = t;
    }
    for (const [k, b] of Object.entries(item.bindings || {})) {
      const d = def.params.find((p) => p.key === k);
      if (!d || d.kind === 'color' || d.options || !b || !REACTIVE_SOURCES.includes(b.source) || !isNum(b.amount)) { issues.push({ path: `${at}.bindings.${k}`, code: 'bad-binding', message: `dropped the binding on "${k}"` }); continue; }
      bindings[k] = { source: b.source, amount: Math.min(1, Math.max(-1, b.amount)) };
    }
    const out = { type: item.type, enabled: item.enabled !== false, params, keyframes, bindings };
    if (item.locked) out.locked = true;
    const lp = (item.lockedParams || []).filter((k) => def.params.some((d) => d.key === k));
    if (lp.length) out.lockedParams = [...new Set(lp)];
    chain.push(out);
  });
  return { chain, issues };
}

/** Fresh item for an effect type at its defaults. */
export function newItem(type, params = {}) {
  const e = createEffect(type, params);
  return { type, enabled: true, params: e.params, keyframes: {}, bindings: {} };
}

/** clip.effects -> chain (drops ids and copies everything). */
export function effectsToChain(effects) {
  return (effects || []).map((e) => structuredClone({ type: e.type, enabled: e.enabled !== false, params: e.params || {}, keyframes: e.keyframes || {}, bindings: e.bindings || {},
    ...(e.locked ? { locked: true } : {}), ...(e.lockedParams?.length ? { lockedParams: e.lockedParams } : {}) }));
}

/** chain -> fresh effect instances with new ids, ready for clip.effects. The chain should have passed validateChain. */
export function chainToEffects(chain) {
  return chain.map((c) => {
    const e = createEffect(c.type, c.params);
    e.enabled = c.enabled !== false;
    e.keyframes = structuredClone(c.keyframes || {});
    e.bindings = structuredClone(c.bindings || {});
    if (c.locked) e.locked = true; // locks live on the effect so they survive being applied, saved and rolled again
    if (c.lockedParams?.length) e.lockedParams = [...c.lockedParams];
    return e;
  });
}

/**
 * Puts a chain in order and within budget.
 *   - one effect per type (unless allowDuplicates)
 *   - 'alpha' and 'ui' stage effects (mask, torn edge, crop, outline, HUD) are moved to the end, so a glitch or a blur never smears them
 *   - at most maxHeavy heavy effects and maxLength effects overall; the later unlocked ones are the ones dropped
 *   - locked effects are never dropped for a duplicate, and within this call they keep their slot (the others fill the remaining slots)
 * @returns {{chain: object[], dropped: {type:string, reason:string}[]}}
 */
export function composeChain(items, { maxLength = MAX_CHAIN, maxHeavy = 2, allowDuplicates = false } = {}) {
  const dropped = [];
  const seen = new Set();
  let kept = [];
  for (const it of items) {
    if (!allowDuplicates && seen.has(it.type) && !it.locked) { dropped.push({ type: it.type, reason: 'duplicate' }); continue; }
    seen.add(it.type);
    kept.push(it);
  }
  let heavy = 0;
  kept = kept.filter((it) => {
    if (!isHeavy(it.type)) return true;
    if (heavy < maxHeavy || it.locked) { heavy++; return true; }
    dropped.push({ type: it.type, reason: 'too-many-heavy' });
    return false;
  });
  while (kept.length > maxLength) {
    let i = kept.length - 1;
    while (i >= 0 && kept[i].locked) i--;
    if (i < 0) break;
    dropped.push({ type: kept[i].type, reason: 'too-long' });
    kept.splice(i, 1);
  }
  // locked effects keep their slot; the rest fill the other slots: free ones first (keeping their order), pinned ones after, by stage
  const free = kept.filter((it) => !it.locked && !isPinnedEnd(it.type));
  const pinned = kept.filter((it) => !it.locked && isPinnedEnd(it.type)).sort((a, b) => stageOrder(a.type) - stageOrder(b.type));
  const queue = [...free, ...pinned];
  const out = kept.map((it) => (it.locked ? it : queue.shift()));
  return { chain: out, dropped };
}
