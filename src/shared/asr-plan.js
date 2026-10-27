// Chunk planning for speech recognition. Whisper drifts and hallucinates on long recordings with silences, so each
// voiced region is transcribed on its own (with the end of the previous text as context). Pure and unit-tested.
import { detectSpeech } from './autoedit.js';

/** Smallest-energy point of `env` inside [a,b] (seconds): where a long region is cut, so we never split a word. */
function quietest(env, a, b) {
  const { rate, rms } = env;
  const i0 = Math.max(0, Math.floor(a * rate)), i1 = Math.min(rms.length - 1, Math.floor(b * rate));
  let best = i0, bestV = Infinity;
  for (let i = i0; i <= i1; i++) {
    // 5-frame mean: ignores single-frame dips inside a vowel
    let s = 0, n = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(rms.length - 1, i + 2); k++) { s += rms[k]; n++; }
    const v = s / n;
    if (v < bestV) { bestV = v; best = i; }
  }
  return best / rate;
}

/**
 * @param {{rate:number, rms:ArrayLike<number>}} env
 * @param {number} total clip length in seconds
 * @returns {Array<{start:number,end:number}>} regions to transcribe, padded and non-overlapping
 */
export function planAsrChunks(env, total, { maxLen = 26, mergeGap = 0.9, pad = 0.25, minLen = 0.3 } = {}) {
  // deliberately permissive (quiet speech must not be dropped before the recogniser has even seen it)
  const speech = detectSpeech(env, { minSilence: mergeGap, minSpeech: minLen, pad: 0, sensitivity: 0.9 });
  const regions = [];
  for (const r of speech) {
    let { start, end } = r;
    while (end - start > maxLen) {
      const cut = quietest(env, start + maxLen * 0.55, start + maxLen);
      regions.push({ start, end: cut });
      start = cut;
    }
    if (end - start >= minLen) regions.push({ start, end });
  }
  return regions.map((r, i) => {
    const prev = regions[i - 1], next = regions[i + 1];
    const lo = prev ? (prev.end + r.start) / 2 : 0, hi = next ? (r.end + next.start) / 2 : total;
    return { start: Math.max(lo, r.start - pad), end: Math.min(hi, r.end + pad, total) };
  });
}

const PROMPT_LIMIT = 140; // Whisper conditions on at most ~224 tokens; Thai is dense, stay well under

/** Prompt = the user's vocabulary (so names/terms are spelled right) + the tail of the previous chunk (continuity). */
export function composePrompt({ terms = [], prev = '' } = {}) {
  const vocab = [...new Set(terms.map((t) => String(t).trim()).filter(Boolean))].join(' ');
  const tail = String(prev).trim().slice(-80);
  return `${vocab} ${tail}`.trim().slice(-PROMPT_LIMIT);
}
