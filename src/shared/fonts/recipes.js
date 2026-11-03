// Font recipes (pure): a recipe is the SMALL thing that describes a font made in the Font lab: which bundled font it starts from, how its outlines are moved, how
// strongly, with which seed, and what it is called. The project stores recipes, never font files; the font is rebuilt when the project opens (src/shared/fonts/sfnt.js).
import { mutateFont, skew, roughen, wave } from './sfnt.js';

export const MAX_RECIPES = 30;
const CJK = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'; // the Latin subset range (name kept short on purpose)
const THAI = 'U+02D7,U+0303,U+0331,U+0E01-0E5B,U+200C-200D,U+25CC';

/** The bundled fonts a new font can start from. `faces` are the WOFF 1.0 files in renderer/fonts/base, each with the characters it covers. */
export const BASES = {
  'noto-sans-thai': { family: 'Noto Sans Thai', weight: 400, label: 'Noto Sans Thai: Thai + Latin', scripts: 'Thai, Latin', faces: [{ file: 'noto-sans-thai-thai-400-normal.woff', range: THAI }, { file: 'noto-sans-thai-latin-400-normal.woff', range: CJK }] },
  'anton': { family: 'Anton', weight: 400, label: 'Anton: tall condensed poster letters', scripts: 'Latin', faces: [{ file: 'anton-latin-400-normal.woff', range: CJK }] },
  'archivo-black': { family: 'Archivo Black', weight: 400, label: 'Archivo Black: heavy grotesque', scripts: 'Latin', faces: [{ file: 'archivo-black-latin-400-normal.woff', range: CJK }] },
  'space-grotesk': { family: 'Space Grotesk', weight: 700, label: 'Space Grotesk Bold: quirky geometric', scripts: 'Latin', faces: [{ file: 'space-grotesk-latin-700-normal.woff', range: CJK }] },
};

/** How each move maps a strength to a change of the outlines. `min`/`max`/`def` are the slider. */
export const MOVES = {
  slant: { label: 'Slant', hint: 'Leans the letters (negative leans left)', min: -1, max: 1, def: 0.5, build: (s) => skew(0.4 * s) },
  wobble: { label: 'Wobble', hint: 'Every outline point drifts a little, like hand-cut letters', min: 0, max: 1, def: 0.5, build: (s, seed) => roughen(0.004 + 0.03 * s, seed) },
  wave: { label: 'Wave', hint: 'The letters ripple sideways like heat haze', min: 0, max: 1, def: 0.5, build: (s, seed) => wave(0.012 + 0.05 * s, 0.4, seed) },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const cleanName = (n) => String(n ?? '').replace(/[^\w \-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);

/** A name that is the artist's own and cannot be mistaken for a font of the computer: it always starts with HHLAB. */
export function fontName(n) { const c = cleanName(n); return /^HHLAB\b/i.test(c) ? c.replace(/^hhlab/i, 'HHLAB') : `HHLAB ${c || 'Font'}`.trim(); }

/** @returns a clean recipe or null when it cannot describe a font */
export function normalizeRecipe(r) {
  if (!r || typeof r !== 'object' || !BASES[r.base] || !MOVES[r.move]) return null;
  const m = MOVES[r.move];
  return { id: String(r.id || '').slice(0, 24) || `fr_${Math.random().toString(36).slice(2, 10)}`, name: fontName(r.name), base: r.base, move: r.move, strength: clamp(Number.isFinite(Number(r.strength)) ? Number(r.strength) : m.def, m.min, m.max), seed: Math.round(clamp(Number.isFinite(Number(r.seed)) ? Number(r.seed) : 1, 1, 9999)) };
}
export function normalizeRecipes(list) {
  const out = [], names = new Set();
  for (const r of Array.isArray(list) ? list : []) { const n = normalizeRecipe(r); if (!n || names.has(n.name.toLowerCase()) || out.length >= MAX_RECIPES) continue; names.add(n.name.toLowerCase()); out.push(n); }
  return out;
}
/** A free default name: "HHLAB Slant 1", "HHLAB Slant 2" ... */
export function suggestName(move, existing = []) {
  const taken = new Set(existing.map((r) => String(r.name).toLowerCase()));
  for (let i = 1; i < 1000; i++) { const n = `HHLAB ${MOVES[move]?.label || 'Font'} ${i}`; if (!taken.has(n.toLowerCase())) return n; }
  return `HHLAB Font ${Date.now() % 100000}`;
}
/** The same recipe always builds the same bytes. */
export const recipeKey = (r) => `${r.base}|${r.move}|${r.strength}|${r.seed}|${r.name}`;

/**
 * Builds every face of a recipe's font.
 * @param loadBytes (file) => Promise<Uint8Array>   reads a base font file
 * @returns {Promise<{bytes:Uint8Array, range:string}[]>}
 */
export async function buildRecipeFaces(recipe, loadBytes, inflate) {
  const r = normalizeRecipe(recipe); if (!r) throw new Error('That is not a font recipe.');
  const out = [];
  for (const face of BASES[r.base].faces) out.push({ range: face.range, bytes: await mutateFont(await loadBytes(face.file), { move: MOVES[r.move].build(r.strength, r.seed), family: r.name, inflate }) });
  return out;
}
