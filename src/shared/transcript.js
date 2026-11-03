// Turns ASR output (fine-grained tokens, or coarse phrase segments) into timed Thai words.
//   tokens  : [{text, start, end}]  seconds, any granularity (single characters from faster-whisper, whole phrases from whisper.cpp)
//   words   : [{text, start, end}]  one entry per real word, monotonic, never overlapping
// Timing model: every character inherits a time inside its token; a word starts at its first character's time
// and ends at its last character's end. When an audio energy envelope is supplied, time inside a phrase is spread over
// the *voiced* part only, so words never land in a pause.
import { cleanThai, segmentWords, isFiller, spokenWeight } from './thai.js';

const SPECIAL = /^\s*(\[[A-Z_ ]+\]|<\|[^|]*\|>|\(.*(music|noise|ดนตรี).*\)|♪+)\s*$/i;

/** @returns {{chars:string, times:Array<[number,number]>}} the full text and a [start,end] for each UTF-16 code unit */
function expand(tokens) {
  let chars = '';
  const times = [];
  for (const tk of tokens) {
    if (!tk || typeof tk.text !== 'string' || SPECIAL.test(tk.text)) continue;
    const text = tk.text.replace(/�/g, '');
    if (!text) continue;
    const n = text.length, dur = Math.max(0, tk.end - tk.start);
    for (let i = 0; i < n; i++) {
      times.push([tk.start + (dur * i) / n, tk.start + (dur * (i + 1)) / n]);
    }
    chars += text;
  }
  return { chars, times };
}

/**
 * Re-assembles tokens into words with times.
 * @param {Array<{text:string,start:number,end:number}>} tokens
 * @param {{minWord?:number}} [o]
 */
export function tokensToWords(tokens, { minWord = 0.08 } = {}) {
  const { chars, times } = expand(tokens);
  if (!chars) return [];
  const words = [];
  // work phrase by phrase: ASR puts spaces between phrases, which are the only reliable boundaries in Thai
  let offset = 0;
  for (const phrase of chars.split(/(\s+)/)) {
    const len = phrase.length;
    if (!phrase.trim()) { offset += len; continue; }
    const clean = cleanThai(phrase);
    const parts = segmentWords(clean);
    // map cleaned text back onto original code-unit positions (clean only removes characters, so scan forward)
    let cursor = 0;
    for (const w of parts) {
      let startIdx = -1, endIdx = -1, k = 0;
      for (let i = cursor; i < phrase.length && k < w.length; i++) {
        if (phrase[i] === w[k]) { if (startIdx < 0) startIdx = i; endIdx = i; k++; cursor = i + 1; }
      }
      if (startIdx < 0) continue;
      words.push({ text: w, start: times[offset + startIdx][0], end: times[offset + endIdx][1] });
    }
    offset += len;
  }
  return enforceTiming(words, minWord);
}

/** Monotonic, non-overlapping, every word at least `minWord` long (borrowing from the following gap when needed). */
export function enforceTiming(words, minWord = 0.08) {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (i > 0 && w.start < words[i - 1].end) w.start = words[i - 1].end;
    if (w.end < w.start + minWord) w.end = w.start + minWord;
    const next = words[i + 1];
    if (next && w.end > next.start && next.start >= w.start + 0.02) w.end = Math.max(w.start + 0.02, next.start);
  }
  for (let i = 1; i < words.length; i++) if (words[i].start < words[i - 1].end) words[i].start = words[i - 1].end;
  for (const w of words) if (w.end < w.start) w.end = w.start;
  return words;
}

/**
 * Re-times the words of ONE phrase (a segment from a coarse engine) so they follow the voiced parts of the audio.
 * @param {string} text phrase text
 * @param {number} start phrase start (s)  @param {number} end phrase end (s)
 * @param {{rate:number, rms:ArrayLike<number>}|null} env audio envelope (feature frames/sec + 0..1 level)
 */
export function wordsForPhrase(text, start, end, env = null, { threshold = 0.08 } = {}) {
  const parts = segmentWords(text);
  if (!parts.length) return [];
  const weights = parts.map(spokenWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  // voiced intervals inside [start,end]
  let voiced = [[start, end]];
  if (env && env.rms && env.rms.length) {
    voiced = [];
    let open = null;
    const a = Math.max(0, Math.floor(start * env.rate)), b = Math.min(env.rms.length - 1, Math.ceil(end * env.rate));
    for (let i = a; i <= b; i++) {
      const on = env.rms[i] >= threshold;
      if (on && open === null) open = i;
      if (!on && open !== null) { voiced.push([open / env.rate, i / env.rate]); open = null; }
    }
    if (open !== null) voiced.push([open / env.rate, (b + 1) / env.rate]);
    // bridge tiny dips (stop consonants) so one syllable is not split
    const merged = [];
    for (const v of voiced) { const last = merged[merged.length - 1]; if (last && v[0] - last[1] < 0.12) last[1] = v[1]; else merged.push([...v]); }
    voiced = merged.filter(([x, y]) => y - x > 0.03);
    if (!voiced.length) voiced = [[start, end]];
    voiced[0][0] = Math.max(voiced[0][0], start); voiced[voiced.length - 1][1] = Math.min(voiced[voiced.length - 1][1], Math.max(end, voiced[voiced.length - 1][0] + 0.05));
  }
  const active = voiced.reduce((s, [x, y]) => s + (y - x), 0);
  // position along the voiced axis -> absolute time
  const at = (p) => {
    let d = p * active;
    for (const [x, y] of voiced) { if (d <= y - x) return x + d; d -= y - x; }
    return voiced[voiced.length - 1][1];
  };
  let acc = 0;
  return parts.map((w, i) => {
    const s = at(acc / total);
    acc += weights[i];
    return { text: w, start: s, end: at(acc / total) };
  });
}

export { isFiller };
