// DNA: a saved creative configuration. It is an effect chain (chain.js) plus what is needed to understand, compare and reproduce it:
//   { schema, id, name, note, tags, createdAt, parentId, seed, source, recipe, chain }
//   parentId  the DNA this one was duplicated or rolled from (lineage)
//   seed      the seed of the roll that made it, when it came from one
//   recipe    {mode:'mutate'|'generate', base, options} — everything mutate()/generate() needs, so reproduceDna() can rebuild the chain
//   source    {kind:'manual'|'mutation'|'look'|'migrated'|'import', ...}
// The library lives in project.dna[] (so it travels with the .hhlab file and is covered by undo and autosave). Built-in looks are
// exposed as read-only DNA by builtinDna() and are never copied into the project unless the user saves one.
// Pure: no DOM, no storage. Time is passed in (`now`) so results stay testable.
import { uid } from '../project.js';
import { EFFECT_PRESETS, instantiatePreset } from '../effects-defs.js';
import { ADJUST_LOOKS, ORGANIC_LOOKS } from '../adjust-defs.js';
import { EFFECT_META, isHeavy } from './effect-meta.js';
import { validateChain, effectsToChain } from './chain.js';
import { mutate, generate } from './mutate.js';
import { toSeed } from './rng.js';

export const DNA_SCHEMA = 1;
export const MAX_LIBRARY = 500;
export const FILE_FORMAT = 'hhdna';
const KINDS = ['manual', 'mutation', 'look', 'migrated', 'import'];

const text = (v, max, fallback = '') => (typeof v === 'string' ? v.trim().slice(0, max) : fallback);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** JSON with sorted keys, so equal chains always give the same string (used for hashes and comparisons). */
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const chainHash = (chain) => toSeed(stableStringify(chain)).toString(36);

function cleanRecipe(r) {
  if (!isObj(r) || !['mutate', 'generate'].includes(r.mode) || !isObj(r.options) || r.options.seed === undefined || r.options.seed === null) return null;
  const { seed, strength, bias, pool, minLength, maxLength, maxHeavy, length } = r.options;
  const options = { seed };
  if (Number.isFinite(strength)) options.strength = strength;
  if (isObj(bias)) options.bias = Object.fromEntries(Object.entries(bias).filter(([, w]) => Number.isFinite(w)));
  if (Array.isArray(pool)) options.pool = pool.filter((t) => typeof t === 'string');
  for (const [k, v] of Object.entries({ minLength, maxLength, maxHeavy, length })) if (Number.isFinite(v)) options[k] = v;
  const base = r.mode === 'mutate' ? validateChain(r.base || []).chain : null;
  return { mode: r.mode, base, options };
}

/**
 * Builds a DNA from loose input; the chain is validated and repaired.
 * @returns {{dna: object, issues: object[]}} issues are the repairs made to the chain
 */
export function createDna({ name, chain, note = '', tags = [], seed = null, parentId = null, source = { kind: 'manual' }, recipe = null, id, now = Date.now() } = {}) {
  const { chain: clean, issues } = validateChain(chain || []);
  const kind = KINDS.includes(source?.kind) ? source.kind : 'manual';
  const dna = {
    schema: DNA_SCHEMA,
    id: text(id, 80) || uid('dna'),
    name: text(name, 80) || 'Untitled DNA',
    note: text(note, 500),
    tags: [...new Set((Array.isArray(tags) ? tags : []).map((t) => text(t, 24)).filter(Boolean))].slice(0, 12),
    createdAt: Number.isFinite(now) ? now : 0,
    parentId: parentId ? text(parentId, 80) : null,
    seed: seed ?? null,
    source: { ...(isObj(source) ? source : {}), kind },
    recipe: cleanRecipe(recipe),
    chain: clean,
  };
  return { dna, issues };
}

/** Repairs a DNA read from a project or a file. Returns {dna: null} when nothing usable is left. */
export function normalizeDna(raw) {
  if (!isObj(raw) || !Array.isArray(raw.chain)) return { dna: null, issues: [{ code: 'not-a-dna', message: 'not a DNA entry' }] };
  if (typeof raw.schema === 'number' && raw.schema > DNA_SCHEMA) return { dna: null, issues: [{ code: 'newer-schema', message: `DNA schema ${raw.schema} is newer than this build (${DNA_SCHEMA})` }] };
  const { dna, issues } = createDna({ ...raw, now: raw.createdAt });
  if (!dna.chain.length) return { dna: null, issues: [...issues, { code: 'empty', message: 'no usable effects left' }] };
  return { dna, issues };
}

// ---- rolls that leave a recipe behind ----

/**
 * Runs mutate() or generate() and wraps the result as a DNA that can be reproduced from its recipe.
 * @param o {mode?, base, options:{seed, strength, …}, name, parentId, now}  mode defaults to 'mutate' when there is a base, else 'generate'
 */
export function dnaFromRoll({ base = [], options, mode, name, parentId = null, note = '', tags = [], now = Date.now() } = {}) {
  if (!options || options.seed === undefined || options.seed === null) throw new Error('dnaFromRoll needs options.seed');
  const m = mode || (base?.length ? 'mutate' : 'generate');
  const out = m === 'mutate' ? mutate(base, options) : generate(options);
  const { dna } = createDna({ name: name || `Roll ${String(options.seed).slice(0, 10)}`, chain: out.chain, note, tags, seed: options.seed, parentId, source: { kind: 'mutation' }, recipe: { mode: m, base: m === 'mutate' ? base : null, options }, now });
  return { dna, report: out.report };
}

/** Rebuilds the chain from the recipe. `same` is false when the DNA was edited after it was rolled (or has no recipe). */
export function reproduceDna(dna) {
  const r = dna?.recipe;
  if (!r) return { chain: null, same: false };
  const out = r.mode === 'mutate' ? mutate(r.base || [], r.options) : generate(r.options);
  return { chain: out.chain, same: stableStringify(out.chain) === stableStringify(validateChain(dna.chain).chain) };
}

// ---- comparing ----

const key = (chain) => { const n = {}; return chain.map((c) => { n[c.type] = (n[c.type] || 0) + 1; return `${c.type}#${n[c.type]}`; }); };
const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b);

/**
 * What differs between two chains (or two DNA). Effects are matched by type (and by occurrence when a type repeats).
 * @returns {{identical:boolean, added:string[], removed:string[], reordered:boolean, enabled:string[], changed:{type,key,from,to}[], summary:{lengthA,lengthB,heavyA,heavyB}}}
 */
export function diffChains(a, b) {
  const A = (a?.chain || a || []), B = (b?.chain || b || []);
  const ka = key(A), kb = key(B), ma = new Map(ka.map((k, i) => [k, A[i]])), mb = new Map(kb.map((k, i) => [k, B[i]]));
  const added = kb.filter((k) => !ma.has(k)).map((k) => mb.get(k).type), removed = ka.filter((k) => !mb.has(k)).map((k) => ma.get(k).type);
  const common = ka.filter((k) => mb.has(k));
  const reordered = stableStringify(common) !== stableStringify(kb.filter((k) => ma.has(k)));
  const changed = [], enabled = [];
  for (const k of common) {
    const x = ma.get(k), y = mb.get(k);
    if ((x.enabled !== false) !== (y.enabled !== false)) enabled.push(x.type);
    for (const p of new Set([...Object.keys(x.params), ...Object.keys(y.params)])) if (!same(x.params[p], y.params[p])) changed.push({ type: x.type, key: p, from: x.params[p], to: y.params[p] });
  }
  return { identical: !added.length && !removed.length && !reordered && !changed.length && !enabled.length, added, removed, reordered, enabled, changed,
    summary: { lengthA: A.length, lengthB: B.length, heavyA: A.filter((c) => isHeavy(c.type)).length, heavyB: B.filter((c) => isHeavy(c.type)).length } };
}

// ---- the library inside a project ----

/** project.dna, repaired in place: entries that are not usable DNA are dropped, ids made unique. */
export function libraryOf(project) {
  if (!Array.isArray(project.dna)) project.dna = [];
  const seen = new Set(), out = [];
  for (const raw of project.dna) {
    const { dna } = normalizeDna(raw);
    if (!dna) continue;
    if (seen.has(dna.id)) dna.id = uid('dna');
    seen.add(dna.id);
    out.push(dna);
  }
  if (stableStringify(out) !== stableStringify(project.dna)) project.dna = out; // only replace when something was actually repaired
  return project.dna;
}

export const findDna = (project, id) => libraryOf(project).find((d) => d.id === id) || null;

/** Adds a DNA (a clone) to the project; a clashing id gets a fresh one. Returns the stored entry, or null when the library is full. */
export function addDna(project, dna) {
  const lib = libraryOf(project);
  if (lib.length >= MAX_LIBRARY) return null;
  const { dna: clean } = normalizeDna(structuredClone(dna));
  if (!clean) return null;
  if (lib.some((d) => d.id === clean.id)) clean.id = uid('dna');
  lib.push(clean);
  return clean;
}

export function removeDna(project, id) {
  const lib = libraryOf(project), i = lib.findIndex((d) => d.id === id);
  if (i < 0) return false;
  lib.splice(i, 1);
  return true;
}

export function renameDna(project, id, name) {
  const d = findDna(project, id), n = text(name, 80);
  if (!d || !n) return false;
  d.name = n;
  return true;
}

/** A copy with a new id, linked to the original through parentId. Works for library entries and built-ins alike. */
export function duplicateDna(dna, { name, now = Date.now() } = {}) {
  const { dna: copy } = createDna({ ...structuredClone(dna), id: undefined, name: name || `${dna.name} copy`, parentId: dna.id, source: dna.source?.kind === 'look' ? { kind: 'manual', from: dna.name } : dna.source, now });
  return copy;
}

/** Ancestors of a DNA that are still in the library, nearest first. */
export function lineage(project, id) {
  const out = [], seen = new Set([id]);
  let cur = findDna(project, id);
  while (cur?.parentId && !seen.has(cur.parentId)) { seen.add(cur.parentId); cur = findDna(project, cur.parentId); if (cur) out.push(cur); }
  return out;
}

// ---- built-in looks as read-only DNA ----

let builtinCache = null;
/** Every ready-made look as a DNA with a stable id `builtin:<group>:<name>`; read-only, created at time 0. */
export function builtinDna() {
  if (builtinCache) return builtinCache;
  const groups = [['effect', EFFECT_PRESETS], ['look', ADJUST_LOOKS], ['organic', ORGANIC_LOOKS]];
  builtinCache = groups.flatMap(([group, list]) => list.map((l) => {
    const { dna } = createDna({ id: `builtin:${group}:${l.name}`, name: l.name, note: l.note || '', tags: [group, ...new Set(l.chain.map((e) => EFFECT_META[e.type]?.category).filter(Boolean))], source: { kind: 'look', group }, chain: effectsToChain(instantiatePreset(l)), now: 0 });
    dna.readOnly = true;
    return dna;
  }));
  return builtinCache;
}
export const isBuiltin = (dna) => !!dna?.readOnly || String(dna?.id || '').startsWith('builtin:');

// ---- files (.hhdna) ----

/** JSON text for sharing one or more DNA. */
export function exportDna(list) {
  const items = (Array.isArray(list) ? list : [list]).map((d) => { const { readOnly, ...rest } = structuredClone(d); return rest; });
  return JSON.stringify({ format: FILE_FORMAT, version: DNA_SCHEMA, items }, null, 2);
}

/**
 * Reads .hhdna text. Never throws: bad JSON, a wrong format or a newer version come back as issues with no items.
 * Imported entries get fresh ids when they would clash with `existing` ids, and are never read-only.
 */
export function parseDnaFile(textIn, existing = []) {
  let data;
  try { data = JSON.parse(textIn); } catch { return { items: [], rejected: 0, issues: [{ code: 'bad-json', message: 'the file is not valid JSON' }] }; }
  if (!isObj(data) || data.format !== FILE_FORMAT || !Array.isArray(data.items)) return { items: [], rejected: 0, issues: [{ code: 'wrong-format', message: 'not an HHL DNA file' }] };
  if (typeof data.version === 'number' && data.version > DNA_SCHEMA) return { items: [], rejected: 0, issues: [{ code: 'newer-version', message: `file version ${data.version} is newer than this build (${DNA_SCHEMA})` }] };
  const taken = new Set(existing.map((d) => d.id)), items = [], issues = [];
  let rejected = 0;
  for (const raw of data.items.slice(0, MAX_LIBRARY)) {
    const { dna, issues: i } = normalizeDna(isObj(raw) ? { ...raw, source: { ...(raw.source || {}), kind: 'import' } } : raw);
    issues.push(...i);
    if (!dna) { rejected++; continue; }
    if (taken.has(dna.id) || isBuiltin(dna)) dna.id = uid('dna');
    taken.add(dna.id);
    items.push(dna);
  }
  if (data.items.length > MAX_LIBRARY) issues.push({ code: 'too-many', message: `only the first ${MAX_LIBRARY} entries were read` });
  return { items, rejected, issues };
}

// ---- migrating the old "Save chain" presets (localStorage) ----

/**
 * Old user presets are {name, chain:[{type, params}]}. Converts the ones not already in the library (matched by name and content).
 * @returns {{items: object[], skipped: number}}
 */
export function migrateUserPresets(list, library = [], { now = Date.now() } = {}) {
  const have = new Set(library.filter((d) => d.source?.kind === 'migrated').map((d) => `${d.name}|${chainHash(d.chain)}`));
  const items = [];
  let skipped = 0;
  for (const p of Array.isArray(list) ? list : []) {
    if (!isObj(p) || !Array.isArray(p.chain)) { skipped++; continue; }
    const { dna } = createDna({ name: p.name, chain: p.chain.map((e) => ({ type: e?.type, params: e?.params })), source: { kind: 'migrated' }, now });
    if (!dna.chain.length) { skipped++; continue; }
    const k = `${dna.name}|${chainHash(dna.chain)}`;
    if (have.has(k)) { skipped++; continue; }
    have.add(k);
    items.push(dna);
  }
  return { items, skipped };
}
