import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { readFont, readSfnt, readGlyphs, mutateGlyphs, writeSfnt, renameFont, readNames, skew, roughen, mutateFont, unitsPerEm, glyphCount } from '../src/shared/fonts/sfnt.js';

const dir = new URL('../node_modules/@fontsource/noto-sans-thai/files/', import.meta.url);
const woff = (n) => new Uint8Array(fs.readFileSync(new URL(n, dir)));
const inflate = (b) => new Uint8Array(zlib.inflateSync(b));
const THAI = 'noto-sans-thai-thai-400-normal.woff', LATIN = 'noto-sans-thai-latin-400-normal.woff';
const RULES = ['GSUB', 'GPOS', 'GDEF', 'cmap', 'OS/2', 'gasp'];
const sumAll = (b) => { const d = new DataView(b.buffer, b.byteOffset, b.byteLength); let s = 0; for (let i = 0; i + 3 < b.length; i += 4) s = (s + d.getUint32(i)) >>> 0; return s; };
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

test('reads a Thai and a Latin WOFF 1.0 font: TrueType outlines, the rules tables present, every glyph readable', async () => {
  for (const f of [THAI, LATIN]) {
    const { flavor, tables } = await readFont(woff(f), inflate);
    assert.equal(flavor, 0x00010000);
    for (const t of ['glyf', 'loca', ...RULES]) assert.ok(tables.has(t), `${f} has ${t}`);
    const glyphs = readGlyphs(tables);
    assert.equal(glyphs.length, glyphCount(tables)); assert.ok(glyphs.length > 20);
    assert.ok(glyphs.some((g) => g?.kind === 'simple' && g.xs.length > 3));
    assert.equal(unitsPerEm(tables), 1000);
  }
});

test('an unchanged move writes a font whose outlines are identical and whose shaping rules are copied byte for byte', async () => {
  for (const f of [THAI, LATIN]) {
    const { flavor, tables } = await readFont(woff(f), inflate);
    const out = writeSfnt(flavor, mutateGlyphs(tables, {}));
    const back = readSfnt(out);
    const a = readGlyphs(tables), b = readGlyphs(back.tables);
    assert.equal(b.length, a.length);
    a.forEach((g, i) => { if (!g) return assert.equal(b[i], null, `glyph ${i} stays empty`); if (g.kind === 'simple') { assert.deepEqual(b[i].xs, g.xs, `glyph ${i} x`); assert.deepEqual(b[i].ys, g.ys, `glyph ${i} y`); assert.deepEqual(b[i].on, g.on); assert.deepEqual(b[i].ends, g.ends); } else assert.deepEqual(b[i].comps.map((c) => [c.gi, c.a1, c.a2]), g.comps.map((c) => [c.gi, c.a1, c.a2])); });
    for (const t of RULES) assert.ok(sameBytes(back.tables.get(t), tables.get(t)), `${f}: ${t} is untouched`);
    assert.equal(sumAll(out), 0xb1b0afba, 'the whole-file checksum is valid (head.checkSumAdjustment)');
    // advance widths are unchanged: only left side bearings follow the outlines
    const ha = new DataView(tables.get('hmtx').buffer, tables.get('hmtx').byteOffset), hb = new DataView(back.tables.get('hmtx').buffer, back.tables.get('hmtx').byteOffset);
    for (let i = 0; i < 20; i++) assert.equal(hb.getUint16(i * 4), ha.getUint16(i * 4), `advance ${i}`);
  }
});

test('skew moves every point by x + k*y; composite glyphs follow, so marks keep their place relative to their letters', async () => {
  const { tables } = await readFont(woff(THAI), inflate);
  const moved = mutateGlyphs(tables, skew(0.2));
  const a = readGlyphs(tables), b = readGlyphs(moved);
  let checked = 0;
  a.forEach((g, i) => { if (g?.kind === 'simple') { g.xs.forEach((x, k) => { assert.equal(b[i].xs[k], Math.round(x + 0.2 * g.ys[k]), `glyph ${i} point ${k}`); assert.equal(b[i].ys[k], g.ys[k]); checked++; }); } });
  assert.ok(checked > 100);
  const comps = a.map((g, i) => [g, b[i]]).filter(([g]) => g?.kind === 'composite');
  for (const [g, h] of comps) g.comps.forEach((c, k) => { if (c.flags & 2) { assert.equal(h.comps[k].a1, Math.round(c.a1 + 0.2 * c.a2)); assert.equal(h.comps[k].a2, c.a2); } });
  assert.equal(sumAll(writeSfnt(0x00010000, moved)), 0xb1b0afba);
});

test('roughen is deterministic (same seed, same font), differs by seed, and stays within its amplitude', async () => {
  const { tables } = await readFont(woff(LATIN), inflate);
  const A = readGlyphs(mutateGlyphs(tables, roughen(0.02, 7))), B = readGlyphs(mutateGlyphs(tables, roughen(0.02, 7))), C = readGlyphs(mutateGlyphs(tables, roughen(0.02, 8))), O = readGlyphs(tables);
  assert.deepEqual(A, B); assert.notDeepEqual(A, C);
  O.forEach((g, i) => { if (g?.kind === 'simple') g.xs.forEach((x, k) => { assert.ok(Math.abs(A[i].xs[k] - x) <= 21, `glyph ${i} x moved by ${A[i].xs[k] - x}`); assert.ok(Math.abs(A[i].ys[k] - g.ys[k]) <= 21); }); });
});

test('the font gets its own name (OFL: a changed font is renamed) and keeps its copyright and licence text', async () => {
  const { tables } = await readFont(woff(THAI), inflate);
  const before = readNames(tables), after = readNames(renameFont(tables, 'HHLAB Wobble'));
  assert.ok(before.some((n) => n.id === 0 && /Noto Project Authors/.test(n.text)) && before.some((n) => n.id === 14 && /OFL/.test(n.text)), 'this font carries its copyright (0) and licence link (14)');
  for (const id of [0, 5, 13, 14, 261, 262, 312]) assert.deepEqual(after.filter((n) => n.id === id).map((n) => n.text), before.filter((n) => n.id === id).map((n) => n.text), `name ${id} kept`);
  assert.ok(after.filter((n) => n.id === 1).every((n) => n.text === 'HHLAB Wobble')); assert.ok(after.filter((n) => n.id === 6).every((n) => n.text === 'HHLABWobble-Regular'));
  assert.ok(!after.some((n) => /Noto Sans Thai/.test(n.text) && [1, 4, 6, 16].includes(n.id)), 'the old family name is gone');
  const ids = after.map((n) => [n.platform, n.encoding, n.language, n.id]); assert.deepEqual(ids, [...ids].sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3]), 'name records are sorted as the format requires');
  assert.equal(renameFont(tables, '').get('name').length > 0, true); assert.equal(readNames(renameFont(tables, '<script>')).find((n) => n.id === 1).text, 'script');
});

test('mutateFont end to end, and damaged input is refused with a plain error (never a hang or a crash)', async () => {
  const out = await mutateFont(woff(THAI), { move: skew(0.15), family: 'HHLAB Slant', inflate });
  assert.equal(sumAll(out), 0xb1b0afba); assert.equal(readNames(readSfnt(out).tables).find((n) => n.id === 1).text, 'HHLAB Slant');
  const good = woff(THAI);
  for (const bad of [new Uint8Array(0), new Uint8Array(100), good.slice(0, 60), good.slice(0, good.length - 500), Uint8Array.from(good, (v, i) => (i > 200 && i < 400 ? v ^ 0xff : v))]) {
    await assert.rejects(() => mutateFont(bad, { move: skew(0.1), inflate }), Error);
  }
  await assert.rejects(() => readFont(new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 1, 0, 0, 0, 0, 0, 0]), inflate), /TrueType/);
});
