// Builds the fonts of Font lab recipes in the window and registers them, so text can use them by name (and the export, which draws in this same window, too).
import { buildRecipeFaces, normalizeRecipe, recipeKey } from '/shared/fonts/recipes.js';

const done = new Map(); // recipeKey -> Promise<FontFace[]>
const inflate = async (b) => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
const loadBytes = async (file) => { const r = await fetch(new URL(`../fonts/base/${file}`, import.meta.url)); if (!r.ok) throw new Error(`The base font ${file} could not be read.`); return new Uint8Array(await r.arrayBuffer()); };

/** Builds and registers one recipe's font (once). Resolves to its family name; rejects with a plain message if it cannot be made. */
export function ensureRecipeFont(recipe) {
  const r = normalizeRecipe(recipe); if (!r) return Promise.reject(new Error('That is not a font recipe.'));
  const key = recipeKey(r);
  if (!done.has(key)) {
    const p = (async () => {
      const faces = [];
      for (const f of await buildRecipeFaces(r, loadBytes, inflate)) { const face = new FontFace(r.name, f.bytes, { unicodeRange: f.range }); await face.load(); document.fonts.add(face); faces.push(face); }
      return faces;
    })();
    p.catch(() => done.delete(key));
    done.set(key, p);
  }
  return done.get(key).then(() => r.name);
}
/** Forgets a font that is no longer wanted (a preview that was replaced). */
export async function dropRecipeFont(recipe) {
  const r = normalizeRecipe(recipe); if (!r) return; const key = recipeKey(r); const p = done.get(key); if (!p) return;
  done.delete(key); try { for (const f of await p) document.fonts.delete(f); } catch { /* it never finished */ }
}
/** Makes every recipe of a project ready; a recipe that fails is skipped (the editor carries on, text just falls back to another font). */
export async function ensureRecipes(list) { const res = await Promise.allSettled((list || []).map(ensureRecipeFont)); return res.filter((x) => x.status === 'fulfilled').length; }
