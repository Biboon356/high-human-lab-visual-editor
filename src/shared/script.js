// Script-aware text helpers. Letters of scripts like Devanagari and Thai are not independent: a consonant, its vowel signs and a
// virama-joined conjunct (क्ष, त्रि) form one visual unit, and the shirorekha (the headline bar) must stay unbroken. Anything that
// splits text for animation, or spaces it, has to work on these units and not on code points.

const DEVANAGARI = /[ऀ-ॿ]/;
const VIRAMA = '्';
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const isConsonant = (ch) => /^[क-हक़-य़ॸ-ॿ]/.test(ch);

export const hasDevanagari = (s) => DEVANAGARI.test(s || '');

/** Visual units of a line: grapheme clusters, with conjuncts joined whatever Unicode version the runtime's ICU knows. */
export function graphemes(s) {
  const base = seg ? Array.from(seg.segment(s), (x) => x.segment) : [...s];
  const out = [];
  for (const g of base) {
    const prev = out[out.length - 1];
    if (prev !== undefined && /्[‌‍]?$/.test(prev) && isConsonant(g)) out[out.length - 1] = prev + g; // क् + ष  ->  क्ष
    else out.push(g);
  }
  return out;
}

/** Letter-spacing in em that is safe for this text: Devanagari must stay tight or its headline bar breaks into dashes. */
export const safeTracking = (text, tracking) => (hasDevanagari(text) ? Math.min(0, tracking || 0) : tracking || 0);

export const VIRAMA_CHAR = VIRAMA;
