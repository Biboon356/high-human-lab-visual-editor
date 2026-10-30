import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateProject } from '../src/shared/project.js';
import { newItem, validateChain, effectsToChain } from '../src/shared/mutation/chain.js';
import { mutate } from '../src/shared/mutation/mutate.js';
import {
  createDna, normalizeDna, dnaFromRoll, reproduceDna, diffChains, libraryOf, findDna, addDna, removeDna, renameDna, duplicateDna, lineage,
  builtinDna, isBuiltin, exportDna, parseDnaFile, migrateUserPresets, chainHash, stableStringify, MAX_LIBRARY, FILE_FORMAT,
} from '../src/shared/mutation/dna.js';
import { EFFECT_PRESETS } from '../src/shared/effects-defs.js';
import { ADJUST_LOOKS } from '../src/shared/adjust-defs.js';

const T = 1_700_000_000_000;
const chainOf = (...types) => types.map((t) => newItem(t));

test('createDna validates the chain, trims text, caps tags and keeps locks', () => {
  const { dna, issues } = createDna({
    name: '  My look  ', note: 'x'.repeat(900), tags: ['a', 'a', ' b ', '', 'c'.repeat(50)], now: T,
    chain: [{ type: 'glitch', params: { amount: 9 }, locked: true }, { type: 'nope' }, { ...newItem('color'), lockedParams: ['hue', 'bogus'] }],
  });
  assert.equal(dna.name, 'My look'); assert.equal(dna.note.length, 500); assert.deepEqual(dna.tags, ['a', 'b', 'c'.repeat(24)]);
  assert.deepEqual(dna.chain.map((c) => c.type), ['glitch', 'color']);
  assert.equal(dna.chain[0].params.amount, 1); assert.equal(dna.chain[0].locked, true);
  assert.deepEqual(dna.chain[1].lockedParams, ['hue']);
  assert.ok(issues.some((i) => i.code === 'unknown-effect') && issues.some((i) => i.code === 'clamped'));
  assert.equal(dna.schema, 1); assert.equal(dna.createdAt, T); assert.equal(dna.source.kind, 'manual'); assert.equal(dna.parentId, null);
  assert.ok(dna.id.startsWith('dna_'));
  assert.equal(createDna({}).dna.name, 'Untitled DNA');
  assert.equal(createDna({ source: { kind: 'weird' } }).dna.source.kind, 'manual');
});

test('normalizeDna repairs, and rejects what cannot be used', () => {
  assert.equal(normalizeDna(null).dna, null);
  assert.equal(normalizeDna({ chain: 'x' }).dna, null);
  assert.equal(normalizeDna({ chain: [{ type: 'nope' }] }).issues.at(-1).code, 'empty');
  assert.equal(normalizeDna({ schema: 99, chain: chainOf('grain') }).issues[0].code, 'newer-schema');
  const { dna } = createDna({ chain: chainOf('grain', 'crt'), name: 'x', now: T });
  assert.deepEqual(normalizeDna(structuredClone(dna)).dna, dna, 'a sound DNA comes back unchanged');
});

test('a roll leaves a recipe: reproduceDna rebuilds the exact chain, and notices when the DNA was edited', () => {
  const base = chainOf('vhs', 'grain');
  const { dna, report } = dnaFromRoll({ base, options: { seed: 321, strength: 0.7 }, now: T });
  assert.equal(dna.seed, 321); assert.equal(dna.source.kind, 'mutation'); assert.equal(dna.recipe.mode, 'mutate');
  assert.deepEqual(dna.chain, mutate(base, { seed: 321, strength: 0.7 }).chain);
  assert.ok(report && Array.isArray(report.changed));
  const r = reproduceDna(dna);
  assert.equal(r.same, true); assert.deepEqual(r.chain, dna.chain);
  // survives a JSON round trip (project save/load)
  assert.equal(reproduceDna(JSON.parse(JSON.stringify(dna))).same, true);
  const edited = structuredClone(dna); edited.chain[0].params = { ...edited.chain[0].params };
  const k = Object.keys(edited.chain[0].params).find((p) => typeof edited.chain[0].params[p] === 'number');
  edited.chain[0].params[k] = edited.chain[0].params[k] === 0 ? 0.01 : 0;
  assert.equal(reproduceDna(edited).same, false);
  assert.equal(reproduceDna(createDna({ chain: base }).dna).chain, null, 'no recipe, nothing to reproduce');
  const gen = dnaFromRoll({ options: { seed: 9, length: 3 }, now: T });
  assert.equal(gen.dna.recipe.mode, 'generate'); assert.equal(gen.dna.chain.length, 3); assert.equal(reproduceDna(gen.dna).same, true);
  assert.throws(() => dnaFromRoll({ base, options: {} }), /seed/);
});

test('diffChains: added, removed, reordered, enabled and parameter changes', () => {
  const a = chainOf('glitch', 'grain', 'crt'), b = structuredClone(a);
  assert.equal(diffChains(a, b).identical, true);
  b[0].params.amount = 0.9; b[1].enabled = false;
  b.push(newItem('vhs')); b.splice(2, 1); // crt out, vhs in
  const d = diffChains(a, b);
  assert.equal(d.identical, false);
  assert.deepEqual(d.added, ['vhs']); assert.deepEqual(d.removed, ['crt']); assert.deepEqual(d.enabled, ['grain']);
  assert.deepEqual(d.changed, [{ type: 'glitch', key: 'amount', from: 0.5, to: 0.9 }]);
  assert.equal(d.reordered, false);
  assert.equal(diffChains(chainOf('glitch', 'grain'), chainOf('grain', 'glitch')).reordered, true);
  assert.equal(diffChains(chainOf('pattern', 'grain'), chainOf('grain')).summary.heavyA, 1);
  // repeated types are matched by occurrence, and DNA objects work as well as bare chains
  const dup = diffChains(chainOf('grain', 'grain'), chainOf('grain'));
  assert.deepEqual(dup.removed, ['grain']);
  assert.equal(diffChains(createDna({ chain: a }).dna, createDna({ chain: a }).dna).identical, true);
});

test('library: add (clone), unique ids, rename, remove, cap, repair on use', () => {
  const p = createProject();
  assert.deepEqual(p.dna, []);
  const { dna } = createDna({ name: 'A', chain: chainOf('grain'), now: T });
  const stored = addDna(p, dna);
  assert.notEqual(stored, dna, 'the project holds a copy');
  stored.name = 'changed'; assert.equal(dna.name, 'A');
  const again = addDna(p, dna);
  assert.notEqual(again.id, dna.id, 'a clashing id gets a fresh one');
  assert.equal(p.dna.length, 2);
  assert.equal(renameDna(p, dna.id, '  Renamed '), true); assert.equal(findDna(p, dna.id).name, 'Renamed');
  assert.equal(renameDna(p, dna.id, '   '), false); assert.equal(renameDna(p, 'nope', 'x'), false);
  assert.equal(removeDna(p, again.id), true); assert.equal(removeDna(p, again.id), false); assert.equal(p.dna.length, 1);
  assert.equal(addDna(p, { chain: [] }), null, 'unusable DNA is not stored');
  // repair: junk and duplicate ids in a hand-edited project
  p.dna.push({ nonsense: true }, structuredClone(p.dna[0]));
  const lib = libraryOf(p);
  assert.equal(lib.length, 2); assert.notEqual(lib[0].id, lib[1].id);
  const q = { dna: Array.from({ length: MAX_LIBRARY }, (_, i) => createDna({ name: `n${i}`, chain: chainOf('grain'), id: `d${i}` }).dna) };
  assert.equal(addDna(q, dna), null, 'a full library says no');
  assert.deepEqual(libraryOf({}), [], 'a project without the field gets an empty library');
});

test('the library saves with the project, loads back, and an old project without it loads fine', () => {
  const p = createProject();
  addDna(p, dnaFromRoll({ base: chainOf('vhs'), options: { seed: 5 }, now: T }).dna);
  const back = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(back.dna.length, 1);
  assert.equal(reproduceDna(back.dna[0]).same, true);
  const old = JSON.parse(JSON.stringify(createProject())); delete old.dna;
  assert.deepEqual(validateProject(old).dna, []);
  const bad = JSON.parse(JSON.stringify(createProject())); bad.dna = 'oops';
  assert.deepEqual(validateProject(bad).dna, []);
});

test('duplicate links back through parentId; lineage walks up; built-ins duplicate into editable manual DNA', () => {
  const p = createProject();
  const a = addDna(p, createDna({ name: 'A', chain: chainOf('crt'), now: T }).dna);
  const b = addDna(p, duplicateDna(a, { now: T + 1 }));
  const c = addDna(p, duplicateDna(b, { name: 'C', now: T + 2 }));
  assert.equal(b.name, 'A copy'); assert.equal(b.parentId, a.id); assert.notEqual(b.id, a.id); assert.deepEqual(b.chain, a.chain);
  assert.deepEqual(lineage(p, c.id).map((d) => d.id), [b.id, a.id]);
  assert.deepEqual(lineage(p, a.id), []);
  const [first] = builtinDna();
  const mine = duplicateDna(first, { now: T });
  assert.equal(mine.parentId, first.id); assert.equal(mine.source.kind, 'manual'); assert.equal(isBuiltin(mine), false); assert.equal(mine.readOnly, undefined);
  assert.deepEqual(mine.chain, first.chain);
});

test('built-in looks are read-only DNA with stable ids, all valid, and not copied into projects', () => {
  const list = builtinDna();
  assert.ok(list.length >= 85, `${list.length} built-in DNA`);
  assert.equal(builtinDna(), list, 'cached');
  assert.equal(new Set(list.map((d) => d.id)).size, list.length);
  for (const d of list) { assert.ok(isBuiltin(d) && d.readOnly, d.name); assert.equal(d.createdAt, 0); assert.deepEqual(validateChain(d.chain).issues, [], d.name); assert.ok(d.chain.length >= 1); }
  assert.ok(list.some((d) => d.id === 'builtin:look:Digicam 2002'));
  assert.ok(list.some((d) => d.id === 'builtin:effect:Broadcast Decay'));
  assert.equal(createProject().dna.length, 0);
  assert.equal(list.filter((d) => d.source.group === 'effect').length, EFFECT_PRESETS.length);
});

test('export and import: round trip, fresh ids on clashes, never read-only, bad files never throw', () => {
  const { dna } = createDna({ name: 'Keep', chain: chainOf('film', 'vhs'), now: T });
  const text = exportDna([builtinDna()[0], dna]);
  assert.equal(JSON.parse(text).format, FILE_FORMAT);
  assert.equal(JSON.parse(text).items[0].readOnly, undefined);
  const r = parseDnaFile(text, [dna]);
  assert.equal(r.items.length, 2); assert.equal(r.rejected, 0);
  assert.ok(r.items.every((d) => !d.readOnly && !d.id.startsWith('builtin:') && d.source.kind === 'import'));
  assert.notEqual(r.items[1].id, dna.id, 'clashes with the library get a new id');
  assert.deepEqual(r.items[1].chain, dna.chain);
  assert.equal(parseDnaFile(exportDna(dna)).items[0].id, dna.id, 'no clash, the id is kept');

  assert.equal(parseDnaFile('not json').issues[0].code, 'bad-json');
  assert.equal(parseDnaFile('{"format":"other","items":[]}').issues[0].code, 'wrong-format');
  assert.equal(parseDnaFile('[]').issues[0].code, 'wrong-format');
  assert.equal(parseDnaFile(JSON.stringify({ format: FILE_FORMAT, version: 9, items: [] })).issues[0].code, 'newer-version');
  const mixed = parseDnaFile(JSON.stringify({ format: FILE_FORMAT, version: 1, items: [dna, { chain: [{ type: 'nope' }] }, 5, { chain: [{ type: 'grain', params: { amount: 99 } }], name: 'Wild' }] }));
  assert.equal(mixed.items.length, 2); assert.equal(mixed.rejected, 2);
  assert.equal(mixed.items[1].chain[0].params.amount, 1, 'imported values are clamped');
});

test('migrating old "Save chain" presets: converted once, junk skipped, repeats ignored', () => {
  const old = [
    { name: 'Mine', chain: [{ type: 'glitch', params: { amount: 0.3 } }, { type: 'crt', params: {} }] },
    { name: 'Broken', chain: [{ type: 'nope' }] },
    'junk',
    { name: 'No chain' },
  ];
  const first = migrateUserPresets(old, [], { now: T });
  assert.equal(first.items.length, 1); assert.equal(first.skipped, 3);
  assert.equal(first.items[0].name, 'Mine'); assert.equal(first.items[0].source.kind, 'migrated'); assert.equal(first.items[0].chain[0].params.amount, 0.3);
  const second = migrateUserPresets(old, first.items, { now: T + 5 });
  assert.equal(second.items.length, 0, 'running it again adds nothing');
  const changed = migrateUserPresets([{ name: 'Mine', chain: [{ type: 'glitch', params: { amount: 0.4 } }] }], first.items);
  assert.equal(changed.items.length, 1, 'same name but different content is a new preset');
  assert.equal(migrateUserPresets(null).items.length, 0);
});

test('stableStringify and chainHash do not depend on key order', () => {
  assert.equal(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] }), stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  const c = chainOf('grain');
  assert.equal(chainHash(c), chainHash(structuredClone(c)));
  assert.notEqual(chainHash(chainOf('grain')), chainHash(chainOf('crt')));
});

test('any look can be turned into DNA and back into the same effect chain', () => {
  for (const l of ADJUST_LOOKS) {
    const d = builtinDna().find((x) => x.id === `builtin:look:${l.name}`);
    assert.ok(d, l.name);
    assert.deepEqual(d.chain.map((c) => c.type), l.chain.map((c) => c.type), l.name);
  }
});
