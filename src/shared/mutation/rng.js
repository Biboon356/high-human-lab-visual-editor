// Seeded randomness for the Mutation Engine. Same seed, same sequence, on every machine (integer maths only, no Math.random).
// mulberry32: the generator the ad-lib planner already used, so its output does not change.

/** Any number or string becomes a 32-bit seed (strings are hashed with FNV-1a). */
export function toSeed(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v) >>> 0;
  let h = 0x811c9dc5;
  for (const ch of String(v ?? '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** A generator returning floats in [0, 1). */
export function rng(seed) {
  let a = toSeed(seed);
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Seed for the n-th child of a parent seed (variation 1, 2, 3 … of the same roll), stable and well spread. */
export const childSeed = (seed, n) => toSeed(`${toSeed(seed)}/${n}`);

/** A fresh seed for "roll again". The only place the engine touches real randomness; everything downstream is reproducible from the result. */
export const newSeed = () => (Math.floor(Math.random() * 0xffffffff) >>> 0);

export const between = (r, lo, hi) => lo + (hi - lo) * r();
export const chance = (r, p) => r() < p;
export const pick = (r, list) => list[Math.min(list.length - 1, Math.floor(r() * list.length))];
/** Triangular noise in (-1, 1): mostly small nudges, now and then a big one. */
export const nudge = (r) => r() + r() - 1;

/** Weighted pick: items are [value, weight]. Returns undefined when every weight is 0. */
export function pickWeighted(r, items) {
  const total = items.reduce((s, [, w]) => s + Math.max(0, w), 0);
  if (!(total > 0)) return undefined;
  let x = r() * total;
  for (const [v, w] of items) { x -= Math.max(0, w); if (x < 0) return v; }
  return items[items.length - 1][0];
}
