import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { BASES, MOVES, normalizeRecipe, normalizeRecipes, suggestName, fontName, recipeKey, buildRecipeFaces, MAX_RECIPES } from '../src/shared/fonts/recipes.js';
import { readSfnt, readGlyphs, readNames, wave } from '../src/shared/fonts/sfnt.js';
import { createProject, validateProject } from '../src/shared/project.js';

const dir = new URL('../src/renderer/fonts/base/', import.meta.url);
const loadBytes = async (f) => new Uint8Array(fs.readFileSync(new URL(f, dir)));
const inflate = (b) => new Uint8Array(zlib.inflateSync(b));
const sumAll = (b) => { const d = new DataView(b.buffer, b.byteOffset, b.byteLength); let s = 0; for (let i = 0; i + 3 < b.length; i += 4) s = (s + d.getUint32(i)) >>> 0; return s; };

test('every offered base font is in the app, is a readable WOFF 1.0 with the shaping tables, and its licence is shipped with it', async () => {
  const licences = fs.readFileSync(new URL('../src/renderer/fonts/LICENSES.txt', import.meta.url), 'utf8');
  for (const [id, b] of Object.entries(BASES)) {
    assert.ok(b.label && b.scripts && b.faces.length >= 1, id);
    for (const f of b.faces) { const bytes = await loadBytes(f.file); assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'wOFF', f.file); assert.match(f.range, /^U\+/); }
    assert.ok(licences.includes(`=== ${id} ===`), `${id}: the licence text is bundled`);
  }
  assert.match(licences, /SIL OPEN FONT LICENSE/i);
});

test('recipes are cleaned: unknown base or move refused, strength kept inside its slider, names always start with HHLAB, no duplicates, no more than the limit', () => {
  assert.equal(normalizeRecipe(null), null); assert.equal(normalizeRecipe({ base: 'nope', move: 'slant' }), null); assert.equal(normalizeRecipe({ base: 'anton', move: 'nope' }), null);
  const r = normalizeRecipe({ id: 'x', name: 'My <b>Cool</b> Font!', base: 'anton', move: 'slant', strength: 9, seed: -5 });
  assert.deepEqual(r, { id: 'x', name: 'HHLAB My bCoolb Font', base: 'anton', move: 'slant', strength: 1, seed: 1 });
  assert.equal(normalizeRecipe({ base: 'anton', move: 'wobble', strength: -3 }).strength, 0, 'wobble does not go negative'); assert.equal(normalizeRecipe({ base: 'anton', move: 'slant', strength: -3 }).strength, -1);
  assert.equal(normalizeRecipe({ base: 'anton', move: 'wave', strength: 'x' }).strength, MOVES.wave.def);
  assert.equal(fontName('hhlab Slant'), 'HHLAB Slant'); assert.equal(fontName(''), 'HHLAB Font'); assert.equal(fontName('Helvetica Neue'), 'HHLAB Helvetica Neue');
  const many = normalizeRecipes([{ name: 'A', base: 'anton', move: 'slant' }, { name: 'a', base: 'anton', move: 'wave' }, { base: 'zzz', move: 'slant' }, ...Array.from({ length: 50 }, (_, i) => ({ name: `F${i}`, base: 'anton', move: 'wobble' }))]);
  assert.equal(many.length, MAX_RECIPES); assert.equal(many.filter((x) => x.name.toLowerCase() === 'hhlab a').length, 1, 'a name is used once');
  assert.deepEqual(normalizeRecipes('x'), []); assert.deepEqual(normalizeRecipes(undefined), []);
  assert.equal(suggestName('slant', []), 'HHLAB Slant 1'); assert.equal(suggestName('slant', [{ name: 'HHLAB Slant 1' }, { name: 'hhlab slant 2' }]), 'HHLAB Slant 3');
});

test('a project keeps its recipes, repairs bad ones and still opens projects that have none', () => {
  assert.deepEqual(createProject().fontRecipes, []);
  const p = createProject(); p.fontRecipes = [{ name: 'Mine', base: 'anton', move: 'wave', strength: 0.3, seed: 4 }, { junk: true }, 5];
  const v = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(v.fontRecipes.length, 1); assert.equal(v.fontRecipes[0].name, 'HHLAB Mine');
  const old = createProject(); delete old.fontRecipes; assert.deepEqual(validateProject(old).fontRecipes, []);
});

test('every base builds with every move: a valid, renamed font whose shaping tables are the original\'s and whose outlines changed', async () => {
  for (const [id, b] of Object.entries(BASES)) {
    for (const move of Object.keys(MOVES)) {
      const rec = { name: `HHLAB T ${id} ${move}`, base: id, move, strength: move === 'slant' ? -0.6 : 0.8, seed: 5 };
      const faces = await buildRecipeFaces(rec, loadBytes, inflate);
      assert.equal(faces.length, b.faces.length);
      for (let i = 0; i < faces.length; i++) {
        const { bytes } = faces[i], out = readSfnt(bytes), src = readSfnt(await (async () => { const { readFont, writeSfnt } = await import('../src/shared/fonts/sfnt.js'); const f = await readFont(await loadBytes(b.faces[i].file), inflate); return writeSfnt(f.flavor, f.tables); })());
        assert.equal(sumAll(bytes), 0xb1b0afba, `${id}/${move}: checksum`);
        for (const t of ['GSUB', 'GPOS', 'GDEF', 'cmap']) if (src.tables.has(t)) assert.ok(out.tables.get(t).every((v, k) => v === src.tables.get(t)[k]) && out.tables.get(t).length === src.tables.get(t).length, `${id}/${move}: ${t} untouched`);
        assert.ok(readNames(out.tables).filter((n) => n.id === 1).every((n) => n.text === rec.name), `${id}/${move}: renamed`);
        const a = readGlyphs(src.tables), c = readGlyphs(out.tables);
        assert.ok(c.some((g, k) => g?.kind === 'simple' && JSON.stringify(g.xs) !== JSON.stringify(a[k].xs)), `${id}/${move}: outlines changed`);
      }
    }
  }
});

test('the same recipe builds the very same font; a different seed or strength builds a different one', async () => {
  const rec = { name: 'HHLAB Same', base: 'anton', move: 'wobble', strength: 0.5, seed: 3 };
  const a = await buildRecipeFaces(rec, loadBytes, inflate), b = await buildRecipeFaces(rec, loadBytes, inflate), c = await buildRecipeFaces({ ...rec, seed: 4 }, loadBytes, inflate), d = await buildRecipeFaces({ ...rec, strength: 0.9 }, loadBytes, inflate);
  assert.ok(a[0].bytes.every((v, i) => v === b[0].bytes[i])); assert.ok(!a[0].bytes.every((v, i) => v === c[0].bytes[i])); assert.ok(!a[0].bytes.every((v, i) => v === d[0].bytes[i]));
  assert.equal(recipeKey(rec), recipeKey({ ...rec })); assert.notEqual(recipeKey(rec), recipeKey({ ...rec, seed: 4 }));
  await assert.rejects(() => buildRecipeFaces({ base: 'nope', move: 'slant' }, loadBytes, inflate), /not a font recipe/);
});

test('wave moves points sideways by a sine of their height and never changes heights', () => {
  const w = wave(0.05, 0.4, 2);
  for (const y of [0, 100, 350, 700]) { const [x, y2] = w.point(500, y, { em: 1000 }); assert.equal(y2, y); assert.ok(Math.abs(x - 500) <= 50 + 1e-9); }
  assert.notEqual(w.point(0, 100, { em: 1000 })[0], w.point(0, 300, { em: 1000 })[0]);
});
