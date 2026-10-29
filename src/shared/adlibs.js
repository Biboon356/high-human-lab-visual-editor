// Ad-libs on the beat: short pop-up words ("yeah!", "x2", "skrrt") placed on chosen beats at slightly different spots and angles.
// Pure planning only; the clips are made from the "Ad-lib Pop (marker)" text preset.

export const DEFAULT_ADLIBS = ['yeah!', 'x2', 'what?', 'skrrt', 'ayy', 'uh', 'gang', 'run it'];

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * @param beats  beat times in seconds
 * @param o      {words, every (use every Nth beat), offset (first beat index), start/end window, seed, hold (seconds on screen)}
 * @returns [{t, duration, word, x, y, rotation}]  x,y are clip position props (frame fractions, y up)
 */
export function planAdlibs(beats, { words = DEFAULT_ADLIBS, every = 4, offset = 0, start = 0, end = Infinity, seed = 1, hold = 0.45 } = {}) {
  const list = (words || []).map((w) => String(w).trim()).filter(Boolean);
  if (!list.length || !beats?.length) return [];
  const r = rng(seed), out = [];
  const picked = beats.filter((b, i) => i >= offset && (i - offset) % Math.max(1, every) === 0 && b >= start && b < end);
  let last = -1;
  picked.forEach((t, i) => {
    const gap = (picked[i + 1] ?? t + hold / 0.85) - t;
    let k = Math.floor(r() * list.length);
    if (list.length > 1 && k === last) k = (k + 1) % list.length; // never the same word twice in a row
    last = k;
    const side = r() < 0.5 ? -1 : 1;
    out.push({ t, duration: Math.min(hold, gap * 0.85), word: list[k], x: side * (0.1 + r() * 0.2), y: (r() - 0.5) * 0.5, rotation: (r() - 0.5) * 22 });
  });
  return out.filter((a) => a.duration >= 0.08);
}
