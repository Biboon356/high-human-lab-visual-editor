// Font spike (pure): read a TrueType-flavoured font (WOFF 1.0 or plain TTF), change only the OUTLINES of its glyphs, and write a plain TTF that a browser can load.
// Everything that makes Thai and Devanagari work (cmap, GSUB, GPOS, GDEF: the rules that place vowels and tone marks) is copied byte for byte, so shaping is untouched.
// Limits of this spike: TrueType outlines only (no CFF / .otf), no WOFF2 input (its glyph table is stored in a transformed form), hinting instructions are dropped,
// composite glyphs are kept (and, for an affine transform, their offsets are moved with it). Nothing here has run on a real Mac or Windows machine.

const u8s = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));
const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** @param inflate (Uint8Array) => Uint8Array | Promise<Uint8Array>  zlib inflate (Node: zlib.inflateSync; browser: DecompressionStream('deflate')) */
export async function readWoff1(bytes, inflate) {
  if (bytes.length < 44 || u8s(bytes, 0, 4) !== 'wOFF') throw new Error('Not a WOFF 1.0 font.');
  const d = dv(bytes), flavor = d.getUint32(4), n = d.getUint16(12), tables = new Map();
  if (n < 1 || n > 64 || 44 + n * 20 > bytes.length) throw new Error('The font table directory is damaged.');
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20, tag = u8s(bytes, o, 4), off = d.getUint32(o + 4), comp = d.getUint32(o + 8), orig = d.getUint32(o + 12);
    if (off + comp > bytes.length || comp > orig * 2 + 64 || orig > 8 << 20) throw new Error(`The font table "${tag}" is damaged.`);
    const raw = bytes.subarray(off, off + comp);
    const data = comp < orig ? await inflate(raw) : raw.slice();
    if (data.length !== orig) throw new Error(`The font table "${tag}" has the wrong size.`);
    tables.set(tag, new Uint8Array(data));
  }
  return { flavor, tables };
}

export function readSfnt(bytes) {
  if (bytes.length < 12) throw new Error('Not a font file.');
  const d = dv(bytes), flavor = d.getUint32(0), n = d.getUint16(4), tables = new Map();
  if (flavor !== 0x00010000 && flavor !== 0x74727565) throw new Error('Only TrueType outlines are supported (not .otf with CFF).');
  if (n < 1 || n > 64 || 12 + n * 16 > bytes.length) throw new Error('The font table directory is damaged.');
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16, tag = u8s(bytes, o, 4), off = d.getUint32(o + 8), len = d.getUint32(o + 12);
    if (off + len > bytes.length) throw new Error(`The font table "${tag}" is damaged.`);
    tables.set(tag, bytes.slice(off, off + len));
  }
  return { flavor, tables };
}

export async function readFont(bytes, inflate) {
  const font = u8s(bytes, 0, 4) === 'wOFF' ? await readWoff1(bytes, inflate) : readSfnt(bytes);
  if (font.flavor !== 0x00010000 && font.flavor !== 0x74727565) throw new Error('Only TrueType outlines are supported (not .otf with CFF).');
  for (const t of ['head', 'maxp', 'loca', 'glyf', 'hhea', 'hmtx', 'cmap']) if (!font.tables.has(t)) throw new Error(`The font has no "${t}" table.`);
  return font;
}

const pad4 = (n) => (n + 3) & ~3;
function checksum(b) { const d = dv(b); let s = 0; const full = b.length & ~3; for (let i = 0; i < full; i += 4) s = (s + d.getUint32(i)) >>> 0; if (b.length > full) { let t = 0; for (let i = 0; i < 4; i++) t = (t << 8) | (full + i < b.length ? b[full + i] : 0); s = (s + (t >>> 0)) >>> 0; } return s; }

export function writeSfnt(flavor, tables) {
  const tags = [...tables.keys()].sort(), n = tags.length;
  let p = 1, e = 0; while (p * 2 <= n) { p *= 2; e++; }
  const dirEnd = 12 + n * 16;
  const padded = tags.map((t) => { const b = tables.get(t); const o = new Uint8Array(pad4(b.length)); o.set(b); if (t === 'head') dv(o).setUint32(8, 0); return o; });
  let off = dirEnd; const offsets = padded.map((b) => { const o = off; off += b.length; return o; });
  const out = new Uint8Array(off), d = dv(out);
  d.setUint32(0, flavor); d.setUint16(4, n); d.setUint16(6, p * 16); d.setUint16(8, e); d.setUint16(10, n * 16 - p * 16);
  tags.forEach((t, i) => { const o = 12 + i * 16; for (let k = 0; k < 4; k++) out[o + k] = t.charCodeAt(k); d.setUint32(o + 4, checksum(padded[i])); d.setUint32(o + 8, offsets[i]); d.setUint32(o + 12, tables.get(t).length); out.set(padded[i], offsets[i]); });
  const headAt = tags.indexOf('head');
  if (headAt >= 0) d.setUint32(offsets[headAt] + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

// ---- glyphs ----
export function unitsPerEm(tables) { return dv(tables.get('head')).getUint16(18); }
export function glyphCount(tables) { return dv(tables.get('maxp')).getUint16(4); }

function glyphOffsets(tables) {
  const head = dv(tables.get('head')), loca = tables.get('loca'), ld = dv(loca), n = glyphCount(tables), long = head.getInt16(50) === 1;
  if (loca.length < (n + 1) * (long ? 4 : 2)) throw new Error('The glyph index table is damaged.');
  const o = []; for (let i = 0; i <= n; i++) o.push(long ? ld.getUint32(i * 4) : ld.getUint16(i * 2) * 2);
  return o;
}

/** @returns {Array<null | {kind:'simple', ends:number[], on:boolean[], xs:number[], ys:number[], overlap:boolean} | {kind:'composite', bbox:number[], comps:object[], instr:Uint8Array|null}>} */
export function readGlyphs(tables) {
  const glyf = tables.get('glyf'), offs = glyphOffsets(tables), out = [];
  for (let g = 0; g < offs.length - 1; g++) {
    const a = offs[g], b = offs[g + 1];
    if (b === a) { out.push(null); continue; }
    if (b < a || b > glyf.length || b - a < 10) throw new Error(`Glyph ${g} is damaged.`);
    const u = glyf.subarray(a, b), d = dv(u), nc = d.getInt16(0), bbox = [d.getInt16(2), d.getInt16(4), d.getInt16(6), d.getInt16(8)];
    let p = 10;
    if (nc >= 0) {
      const ends = []; for (let c = 0; c < nc; c++) { ends.push(d.getUint16(p)); p += 2; }
      const np = nc ? ends[nc - 1] + 1 : 0; p += 2 + d.getUint16(p);
      if (np > 20000 || p > u.length) throw new Error(`Glyph ${g} is damaged.`);
      const flags = []; while (flags.length < np) { const f = u[p++]; flags.push(f); if (f & 8) { let r = u[p++]; while (r-- > 0 && flags.length < np) flags.push(f); } }
      const coord = (shortBit, sameBit) => { const v = []; let x = 0; for (let i = 0; i < np; i++) { const f = flags[i]; if (f & shortBit) { const dd = u[p++]; x += f & sameBit ? dd : -dd; } else if (!(f & sameBit)) { x += d.getInt16(p); p += 2; } v.push(x); } return v; };
      const xs = coord(2, 16), ys = coord(4, 32);
      if (p > u.length) throw new Error(`Glyph ${g} is damaged.`);
      out.push({ kind: 'simple', ends, on: flags.map((f) => !!(f & 1)), xs, ys, overlap: !!(flags[0] & 0x40) });
    } else {
      const comps = []; let more = true, instr = false;
      while (more) {
        if (p + 4 > u.length) throw new Error(`Glyph ${g} is damaged.`);
        const flags = d.getUint16(p), gi = d.getUint16(p + 2); p += 4;
        const words = !!(flags & 1), xy = !!(flags & 2);
        let a1, a2; if (words) { a1 = xy ? d.getInt16(p) : d.getUint16(p); a2 = xy ? d.getInt16(p + 2) : d.getUint16(p + 2); p += 4; } else { a1 = xy ? d.getInt8(p) : u[p]; a2 = xy ? d.getInt8(p + 1) : u[p + 1]; p += 2; }
        const xl = flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0;
        comps.push({ flags, gi, a1, a2, xform: u.slice(p, p + xl) }); p += xl;
        if (flags & 0x100) instr = true; more = !!(flags & 0x20);
      }
      out.push({ kind: 'composite', bbox, comps, instr });
    }
  }
  return out;
}

const bboxOf = (xs, ys) => (xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 0, 0]);

function encodeSimple(g) {
  const np = g.xs.length, flags = [], xb = [], yb = [];
  let px = 0, py = 0;
  for (let i = 0; i < np; i++) {
    const dx = g.xs[i] - px, dy = g.ys[i] - py; px = g.xs[i]; py = g.ys[i];
    let f = g.on[i] ? 1 : 0;
    if (dx === 0) f |= 16; else if (Math.abs(dx) <= 255) { f |= 2 | (dx > 0 ? 16 : 0); xb.push(Math.abs(dx)); } else { xb.push((dx >> 8) & 255, dx & 255); }
    if (dy === 0) f |= 32; else if (Math.abs(dy) <= 255) { f |= 4 | (dy > 0 ? 32 : 0); yb.push(Math.abs(dy)); } else { yb.push((dy >> 8) & 255, dy & 255); }
    if (i === 0 && g.overlap) f |= 0x40;
    flags.push(f);
  }
  const [x0, y0, x1, y1] = bboxOf(g.xs, g.ys), nc = g.ends.length;
  const out = new Uint8Array(10 + nc * 2 + 2 + np + xb.length + yb.length), d = dv(out);
  d.setInt16(0, nc); d.setInt16(2, x0); d.setInt16(4, y0); d.setInt16(6, x1); d.setInt16(8, y1);
  let p = 10; for (const e of g.ends) { d.setUint16(p, e); p += 2; }
  d.setUint16(p, 0); p += 2; // no hinting instructions: the outline changed, the old instructions no longer fit it
  flags.forEach((f) => { out[p++] = f; }); xb.forEach((v) => { out[p++] = v; }); yb.forEach((v) => { out[p++] = v; });
  return { bytes: out, bbox: [x0, y0, x1, y1] };
}

function encodeComposite(g, bbox) {
  const parts = [];
  g.comps.forEach((c, i) => {
    const xy = !!(c.flags & 2), words = !!(c.flags & 1) || xy && (c.a1 < -128 || c.a1 > 127 || c.a2 < -128 || c.a2 > 127);
    let f = c.flags; if (words) f |= 1; f &= ~0x100; f = i === g.comps.length - 1 ? f & ~0x20 : f | 0x20; // instructions are dropped
    const b = new Uint8Array(4 + (words ? 4 : 2) + c.xform.length), d = dv(b);
    d.setUint16(0, f); d.setUint16(2, c.gi);
    if (words) { if (xy) { d.setInt16(4, c.a1); d.setInt16(6, c.a2); } else { d.setUint16(4, c.a1); d.setUint16(6, c.a2); } } else if (xy) { d.setInt8(4, c.a1); d.setInt8(5, c.a2); } else { b[4] = c.a1; b[5] = c.a2; }
    b.set(c.xform, 4 + (words ? 4 : 2)); parts.push(b);
  });
  const len = 10 + parts.reduce((s, b) => s + b.length, 0), out = new Uint8Array(len), d = dv(out);
  d.setInt16(0, -1); bbox.forEach((v, i) => d.setInt16(2 + i * 2, v));
  let p = 10; for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}

const clamp16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));

/**
 * Returns a new table map whose glyph outlines went through the transform; every other table is shared untouched except those that must follow the outlines
 * (glyf, loca, head's box and loca format, hhea's extents, hmtx's left side bearings).
 * @param t {point?: (x, y, ctx:{glyph:number, index:number, em:number}) => [x, y], offset?: (dx, dy) => [dx, dy], box?: (x, y) => [x, y]}
 *   `point` moves every point of every simple glyph. `offset` moves the placement of components inside composite glyphs (give it only for an affine move that
 *   should carry composites along, e.g. a skew). `box` moves the corners of a composite's bounding box (defaults to `point` without ctx).
 */
export function mutateGlyphs(tables, t) {
  const glyphs = readGlyphs(tables), em = unitsPerEm(tables), hhea = dv(tables.get('hhea')), numH = hhea.getUint16(34);
  const oldH = tables.get('hmtx'), hd = dv(oldH), nGlyphs = glyphs.length;
  const chunks = [], offs = [0]; let total = 0;
  const bboxes = [], push = (b) => { chunks.push(b); const padded = pad4(b.length); total += padded; offs.push(total); };
  glyphs.forEach((g, gi) => {
    if (!g) { bboxes.push(null); offs.push(total); chunks.push(null); return; }
    if (g.kind === 'simple') {
      const xs = [], ys = [];
      for (let i = 0; i < g.xs.length; i++) { const [x, y] = t.point ? t.point(g.xs[i], g.ys[i], { glyph: gi, index: i, em }) : [g.xs[i], g.ys[i]]; xs.push(clamp16(x)); ys.push(clamp16(y)); }
      const e = encodeSimple({ ...g, xs, ys }); bboxes.push(e.bbox); push(e.bytes);
    } else {
      const comps = g.comps.map((c) => { if (!t.offset || !(c.flags & 2)) return c; const [a1, a2] = t.offset(c.a1, c.a2); return { ...c, a1: clamp16(a1), a2: clamp16(a2) }; });
      const boxFn = t.box || (t.point ? (x, y) => t.point(x, y, { glyph: gi, index: -1, em }) : null);
      let bb = g.bbox;
      if (boxFn && t.offset) { const c = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]].map(([x, y]) => boxFn(x, y)); bb = bboxOf(c.map((p) => clamp16(p[0])), c.map((p) => clamp16(p[1]))); }
      bboxes.push(bb); push(encodeComposite({ ...g, comps }, bb));
    }
  });
  // drop the null placeholders we pushed to keep offsets aligned, then lay out glyf + a long loca
  const glyf = new Uint8Array(total), loca = new Uint8Array((nGlyphs + 1) * 4), ld = dv(loca);
  let at = 0; for (let i = 0; i < nGlyphs; i++) { ld.setUint32(i * 4, at); const b = chunks[i]; if (b) { glyf.set(b, at); at += pad4(b.length); } }
  ld.setUint32(nGlyphs * 4, at);
  const out = new Map(tables); out.set('glyf', glyf.slice(0, at)); out.set('loca', loca);
  const head = tables.get('head').slice(); dv(head).setInt16(50, 1); // long loca
  // left side bearings follow the new outlines; extents follow the new boxes
  const hm = new Uint8Array(oldH.length), md = dv(hm); hm.set(oldH);
  const adv = (i) => hd.getUint16(Math.min(i, numH - 1) * 4);
  let minLsb = 32767, minRsb = 32767, xMaxExt = -32768, bx0 = 32767, by0 = 32767, bx1 = -32768, by1 = -32768;
  bboxes.forEach((bb, i) => {
    if (!bb) return;
    const lsb = bb[0]; if (i < numH) md.setInt16(i * 4 + 2, lsb); else md.setInt16(numH * 4 + (i - numH) * 2, lsb);
    const w = bb[2] - bb[0]; minLsb = Math.min(minLsb, lsb); minRsb = Math.min(minRsb, adv(i) - (lsb + w)); xMaxExt = Math.max(xMaxExt, lsb + w);
    bx0 = Math.min(bx0, bb[0]); by0 = Math.min(by0, bb[1]); bx1 = Math.max(bx1, bb[2]); by1 = Math.max(by1, bb[3]);
  });
  const hh = tables.get('hhea').slice(), hdv = dv(hh);
  if (xMaxExt > -32768) { hdv.setInt16(12, minLsb); hdv.setInt16(14, clamp16(minRsb)); hdv.setInt16(16, xMaxExt); const h = dv(head); h.setInt16(36, bx0); h.setInt16(38, by0); h.setInt16(40, bx1); h.setInt16(42, by1); }
  out.set('hmtx', hm); out.set('hhea', hh); out.set('head', head);
  return out;
}

// ---- ready-made outline moves ----
/** Slants the letters (negative k leans them left). Composite glyphs follow, so marks keep their places. */
export const skew = (k) => ({ point: (x, y) => [x + k * y, y], offset: (dx, dy) => [dx + k * dy, dy] });
/** A small deterministic wobble of every outline point (same seed, same font). Composite offsets are left alone: their parts wobble identically wherever they are used. */
export function roughen(amount, seed = 1) {
  const hash = (a, b) => { let h = (seed * 374761393 + a * 668265263 + b * 2147483647) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  return { point: (x, y, c) => [x + (hash(c.glyph, c.index * 2) - 0.5) * 2 * amount * c.em, y + (hash(c.glyph, c.index * 2 + 1) - 0.5) * 2 * amount * c.em] };
}

/** A sideways ripple: every point moves along x by a sine of its height (amp and period are fractions of the em; the seed sets where the wave starts). Composite offsets are left alone. */
export function wave(amp, period = 0.4, seed = 1) {
  const phase = ((seed * 137.508) % 360) * Math.PI / 180;
  return { point: (x, y, c) => [x + amp * c.em * Math.sin((2 * Math.PI * y) / (period * c.em) + phase), y] };
}

// ---- names (OFL: a changed font gets its own name) ----
const utf16 = (s) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) >> 8; b[i * 2 + 1] = s.charCodeAt(i) & 255; } return b; };
const latin1 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);
export function readNames(tables) {
  const n = tables.get('name'); if (!n) return [];
  const d = dv(n), count = d.getUint16(2), so = d.getUint16(4), out = [];
  for (let i = 0; i < count; i++) { const o = 6 + i * 12; const platform = d.getUint16(o), encoding = d.getUint16(o + 2), language = d.getUint16(o + 4), id = d.getUint16(o + 6), len = d.getUint16(o + 8), off = d.getUint16(o + 10); const raw = n.subarray(so + off, so + off + len); out.push({ platform, encoding, language, id, text: platform === 1 ? String.fromCharCode(...raw) : Array.from({ length: raw.length >> 1 }, (_, k) => String.fromCharCode((raw[k * 2] << 8) | raw[k * 2 + 1])).join('') }); }
  return out;
}
/** New names for family/full/PostScript/typographic family (and unique id); everything else (copyright, licence, designer ...) is kept as it was. */
export function renameFont(tables, family) {
  const fam = String(family).replace(/[^\w \-]/g, '').trim().slice(0, 40) || 'HHLAB Font';
  const ps = fam.replace(/\s+/g, '') + '-Regular';
  const recs = readNames(tables).filter((r) => r.platform === 3 || r.platform === 1);
  const set = { 1: fam, 4: `${fam} Regular`, 6: ps, 16: fam, 3: `${ps};HHLAB`, 2: 'Regular', 17: 'Regular' };
  const have = new Set(recs.map((r) => r.id));
  for (const id of [1, 2, 3, 4, 6]) if (!have.has(id)) recs.push({ platform: 3, encoding: 1, language: 0x409, id, text: '' });
  const rows = recs.map((r) => ({ ...r, text: r.id in set && (r.id !== 16 && r.id !== 17 || have.has(r.id)) ? set[r.id] : r.text }));
  rows.sort((a, b) => a.platform - b.platform || a.encoding - b.encoding || a.language - b.language || a.id - b.id);
  const strs = rows.map((r) => (r.platform === 1 ? latin1(r.text) : utf16(r.text)));
  const so = 6 + rows.length * 12, size = so + strs.reduce((s, b) => s + b.length, 0), out = new Uint8Array(size), d = dv(out);
  d.setUint16(0, 0); d.setUint16(2, rows.length); d.setUint16(4, so);
  let off = 0; rows.forEach((r, i) => { const o = 6 + i * 12; d.setUint16(o, r.platform); d.setUint16(o + 2, r.encoding); d.setUint16(o + 4, r.language); d.setUint16(o + 6, r.id); d.setUint16(o + 8, strs[i].length); d.setUint16(o + 10, off); out.set(strs[i], so + off); off += strs[i].length; });
  const t = new Map(tables); t.set('name', out); return t;
}

/** The whole spike in one call: font bytes in, a renamed TTF with changed outlines out. */
export async function mutateFont(bytes, { move, family = 'HHLAB Mutant', inflate }) {
  const { flavor, tables } = await readFont(bytes, inflate);
  const moved = move ? mutateGlyphs(tables, move) : tables;
  return writeSfnt(flavor, renameFont(moved, family));
}
