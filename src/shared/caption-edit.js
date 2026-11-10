// Editing captions after the fact: a corrected line keeps the timing of the words that did not change, and the words that
// replaced others share the time the old ones had. Pure; the renderer turns the result back into caption clips.
import { cleanThai, segmentWords, spokenWeight } from './thai.js';
import { planCaptions } from './captions.js';
import { enforceTiming } from './transcript.js';

/** A caption clip -> the card shape planCaptions() produces (absolute seconds, word char ranges). */
export function cardFromClip(clip) {
  const text = clip.text?.content ?? '';
  const start = clip.start, end = clip.start + clip.duration;
  const kw = clip.text?.karaoke?.words;
  let words;
  if (kw?.length) {
    words = kw.map((w) => ({ text: text.slice(w.from, w.to), start: start + w.start, end: start + w.end, from: w.from, to: w.to }));
  } else {
    const parts = segmentWords(cleanThai(text.replace(/\n/g, '')));
    const weights = parts.map(spokenWeight), total = weights.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    words = parts.map((w, i) => { const s = start + (acc / total) * (end - start); acc += weights[i]; return { text: w, start: s, end: start + (acc / total) * (end - start) }; });
  }
  return { start, end, text, words };
}

/** Longest-common-subsequence alignment of two word-text lists -> pairs [oldIndex, newIndex] of unchanged words. */
function matches(a, b) {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return out;
}

/** New timed words for `newText`, anchored on the unchanged words of `card`. */
export function retimeWords(card, newText) {
  const fresh = segmentWords(cleanThai(String(newText).replace(/\n/g, '')));
  if (!fresh.length) return [];
  const old = card.words;
  const anchors = matches(old.map((w) => w.text), fresh);
  const out = new Array(fresh.length);
  for (const [i, j] of anchors) out[j] = { text: fresh[j], start: old[i].start, end: old[i].end };
  // fill each run of new words between two anchors from the time span the old words in that gap covered
  const bounds = [[-1, -1], ...anchors, [old.length, fresh.length]];
  for (let k = 0; k < bounds.length - 1; k++) {
    const [oi, nj] = bounds[k], [oi2, nj2] = bounds[k + 1];
    const run = [];
    for (let j = nj + 1; j < nj2; j++) run.push(j);
    if (!run.length) continue;
    const prevEnd = oi >= 0 ? old[oi].end : card.start, nextStart = oi2 < old.length ? old[oi2].start : card.end;
    const gapOld = old.slice(oi + 1, oi2);
    const span0 = gapOld.length ? gapOld[0].start : prevEnd, span1 = gapOld.length ? gapOld.at(-1).end : Math.max(prevEnd, nextStart);
    const weights = run.map((j) => spokenWeight(fresh[j])), total = weights.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    run.forEach((j, idx) => { const s = span0 + (acc / total) * (span1 - span0); acc += weights[idx]; out[j] = { text: fresh[j], start: s, end: span0 + (acc / total) * (span1 - span0) }; });
  }
  return enforceTiming(out.map((w) => ({ ...w })), 0.06);
}

/** Corrected text -> one or more cards (more than one only if the new line no longer fits). */
export function rebuildCards(card, newText, { maxWidth = 16, maxLines = 2 } = {}) {
  const words = retimeWords(card, newText);
  if (!words.length) return [];
  const cards = planCaptions(words, { maxWidth, maxLines, maxDuration: Infinity, breakGap: Infinity, minDuration: 0, dropFillers: false, lead: 0, hold: 0 });
  // keep the line on screen for exactly as long as the original card was
  cards[0].start = card.start; cards.at(-1).end = card.end;
  return cards;
}

/** A copy of caption `clip` showing `card` (same look, new text/timing/karaoke words). */
export function retextClip(clip, card) {
  const c = structuredClone(clip);
  c.start = card.start; c.duration = Math.max(0.1, card.end - card.start);
  c.name = card.text.replace(/\n/g, ' ').slice(0, 40);
  c.text.content = card.text;
  if (c.text.karaoke) c.text.karaoke.words = card.words.map((w) => ({ from: w.from, to: w.to, start: w.start - card.start, end: w.end - card.start }));
  return c;
}
