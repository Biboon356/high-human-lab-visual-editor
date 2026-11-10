// The user's correction dictionary: "what the recogniser keeps writing" -> "what it should have written".
// It does two jobs: fixes every future transcript, and biases Whisper toward the right spellings (via its prompt).
import { segmentWords } from './thai.js';

const MAX_ENTRIES = 300;

export function normalizeGlossary(list) {
  const seen = new Map();
  for (const e of Array.isArray(list) ? list : []) {
    const from = String(e?.from ?? '').trim(), to = String(e?.to ?? '').trim();
    if (from.length < 2 || !to || from === to || from.length > 40 || to.length > 40) continue;
    seen.set(from, { from, to });
  }
  return [...seen.values()].slice(-MAX_ENTRIES);
}

/** Longest `from` first so "ติ๊กต็อก" wins over a shorter entry it contains. */
export function applyGlossary(text, list) {
  let out = String(text);
  for (const { from, to } of normalizeGlossary(list).sort((a, b) => b.from.length - a.from.length)) out = out.split(from).join(to);
  return out;
}

export const promptTerms = (list) => [...new Set(normalizeGlossary(list).map((e) => e.to))];

/** Longest-common-subsequence diff over words; returns the replaced runs ("wrong" -> "right"). */
export function learnCorrections(before, after, { maxChars = 16 } = {}) {
  const a = segmentWords(String(before)), b = segmentWords(String(after));
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0, ra = [], rb = [];
  const flush = () => {
    if (ra.length && rb.length) {
      const from = ra.join(''), to = rb.join('');
      if (from !== to && from.length >= 2 && from.length <= maxChars && to.length <= maxChars) out.push({ from, to });
    }
    ra = []; rb = [];
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) { flush(); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) ra.push(a[i++]);
    else rb.push(b[j++]);
  }
  while (i < n) ra.push(a[i++]);
  while (j < m) rb.push(b[j++]);
  flush();
  return normalizeGlossary(out);
}
