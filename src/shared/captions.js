// Caption planning: timed words -> short, readable, TikTok-sized caption cards. Pure.
// Rules: never break inside a Thai word, at most `maxLines` lines of `maxWidth` display columns, break on pauses and
// sentence ends, keep cards on screen long enough to read, and record each word's character range for karaoke highlighting.
import { displayWidth, hasThai, isFiller } from './thai.js';

const SENTENCE_END = /[.!?…。！？]$|(?:ครับ|ค่ะ|คะ|นะ|เลย|แล้ว)[.!?]*$/;
const HARD_END = /[.!?…。！？]$/;

/** Joins words into display text: Thai words touch, Latin/number words are separated by a space. */
export function joinWords(words) {
  let s = '';
  words.forEach((w, i) => {
    if (i > 0) {
      const a = words[i - 1].text, b = w.text;
      if (!hasThai(a.slice(-1)) && !hasThai(b[0]) && /[\p{L}\p{N}]$/u.test(a) && /^[\p{L}\p{N}]/u.test(b)) s += ' ';
    }
    s += w.text;
  });
  return s;
}

/** Splits `words` into <= maxLines lines with the most even widths (Thai words are atomic). Returns arrays of word indexes. */
export function breakLines(words, maxLines = 2, maxWidth = 14) {
  const widths = words.map((w) => displayWidth(w.text));
  const total = widths.reduce((a, b) => a + b, 0);
  if (maxLines <= 1 || total <= maxWidth) return [words.map((_, i) => i)];
  let best = null;
  const n = words.length;
  // try every cut for 2 lines (the TikTok norm); for 3 lines fall back to greedy
  if (maxLines === 2) {
    let acc = 0;
    for (let cut = 1; cut < n; cut++) {
      acc += widths[cut - 1];
      const a = acc, b = total - acc, score = Math.max(a, b) + (Math.max(a, b) > maxWidth ? 100 : 0);
      if (!best || score < best.score) best = { cut, score };
    }
    return [[...Array(best.cut).keys()], [...Array(n - best.cut).keys()].map((i) => i + best.cut)];
  }
  const lines = [[]];
  let w = 0;
  words.forEach((_, i) => { if (w + widths[i] > maxWidth && lines.at(-1).length) { lines.push([]); w = 0; } lines.at(-1).push(i); w += widths[i]; });
  return lines;
}

/**
 * @param {Array<{text:string,start:number,end:number}>} words
 * @param {{maxWidth?:number,maxLines?:number,maxDuration?:number,minDuration?:number,breakGap?:number,dropFillers?:boolean,lead?:number,hold?:number}} o
 * @returns {Array<{start:number,end:number,text:string,words:Array<{text:string,start:number,end:number,from:number,to:number}>}>}
 *   `from`/`to` are character offsets of each word inside `text` (so a renderer can highlight a word)
 */
export function planCaptions(words, { maxWidth = 14, maxLines = 2, maxDuration = 3.4, minDuration = 0.6, breakGap = 0.5, dropFillers = true, lead = 0.04, hold = 0.3 } = {}) {
  const src = words.filter((w) => !(dropFillers && isFiller(w.text)));
  const groups = [];
  let cur = [];
  const capacity = maxWidth * maxLines;
  const widthOf = (arr) => arr.reduce((a, w) => a + displayWidth(w.text), 0);
  for (let i = 0; i < src.length; i++) {
    const w = src[i], prev = cur.at(-1);
    const gap = prev ? w.start - prev.end : 0;
    const tooLong = cur.length && widthOf(cur) + displayWidth(w.text) > capacity;
    const tooSlow = cur.length && w.end - cur[0].start > maxDuration;
    const pause = cur.length && gap > breakGap;
    const sentence = prev && HARD_END.test(prev.text);
    if (cur.length && (tooLong || tooSlow || pause || sentence)) { groups.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);

  // avoid orphan one-word cards by merging them into a neighbour when it fits
  for (let i = groups.length - 1; i > 0; i--) {
    const g = groups[i];
    if (g.length === 1 && widthOf(groups[i - 1]) + widthOf(g) <= capacity && g[0].start - groups[i - 1].at(-1).end <= breakGap && groups[i - 1].at(-1).end - groups[i - 1][0].start + (g[0].end - g[0].start) <= maxDuration + 0.4 && !HARD_END.test(groups[i - 1].at(-1).text)) {
      groups[i - 1].push(...g); groups.splice(i, 1);
    }
  }

  const cards = groups.map((g) => {
    const lines = breakLines(g, maxLines, maxWidth);
    const parts = lines.map((idxs) => joinWords(idxs.map((i) => g[i])));
    const text = parts.join('\n');
    // character ranges per word (computed by walking the joined text)
    const ranged = [];
    let pos = 0;
    lines.forEach((idxs, li) => {
      const lineWords = idxs.map((i) => g[i]);
      let linePos = 0;
      const lineText = parts[li];
      lineWords.forEach((w) => {
        const at = lineText.indexOf(w.text, linePos);
        const from = pos + (at < 0 ? linePos : at);
        ranged.push({ ...w, from, to: from + w.text.length });
        linePos = (at < 0 ? linePos : at) + w.text.length;
      });
      pos += lineText.length + 1;
    });
    return { start: Math.max(0, g[0].start - lead), end: g.at(-1).end + hold, text, words: ranged };
  });

  // readable timing: min duration, never overlap the next card
  cards.forEach((c, i) => {
    const nextStart = cards[i + 1]?.start ?? Infinity;
    if (c.end - c.start < minDuration) c.end = c.start + minDuration;
    c.end = Math.min(c.end, nextStart - 0.02);
    if (c.end <= c.start) c.end = c.start + 0.1;
  });
  return cards;
}
