// Thai text utilities used by the caption pipeline. Pure; relies only on Intl.Segmenter (ICU Thai dictionary).
// Thai has no spaces between words, vowels/tone marks are combining characters, and ASR engines emit sub-syllable
// fragments — so captions must be re-assembled into real words before they are timed, wrapped or highlighted.

const THAI = /[฀-๿]/;
// combining marks: mai han-akat, above/below vowels, phinthu, mai tai khu, tone marks, thanthakhat, nikhahit, yamakkan
const COMBINING = /[ัิ-ฺ็-๎]/;
const ZERO_WIDTH = /[​-‍⁠﻿]/g;
const REPLACEMENT = /�/g;

const wordSeg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;

export const hasThai = (s) => THAI.test(s);

/** NFC, drop zero-width/invalid characters, collapse duplicated tone/vowel marks and runs of whitespace. */
export function cleanThai(text) {
  return text
    .normalize('NFC')
    .replace(REPLACEMENT, '')
    .replace(ZERO_WIDTH, '')
    .replace(/([ัิ-ฺ็-๎])\1+/g, '$1') // doubled combining mark (a common ASR glitch)
    .replace(/[ \t ]+/g, ' ')
    .trim();
}

/** Visual column width: combining marks take no column, Thai letters one, wide CJK/emoji two. */
export function displayWidth(s) {
  let w = 0;
  for (const ch of s) {
    if (COMBINING.test(ch)) continue;
    const cp = ch.codePointAt(0);
    w += cp >= 0x1100 && (cp <= 0x115f || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x1f300 && cp <= 0x1faff)) ? 2 : 1;
  }
  return w;
}

/** Splits text into words (Thai dictionary segmentation, Latin words, numbers). Punctuation sticks to the previous word. */
export function segmentWords(text) {
  const out = [];
  const t = cleanThai(text);
  if (!t) return out;
  const items = wordSeg ? [...wordSeg.segment(t)] : t.split(/(\s+)/).filter(Boolean).map((segment) => ({ segment, isWordLike: !/^\s+$/.test(segment) }));
  for (const it of items) {
    const seg = it.segment;
    if (/^\s+$/.test(seg)) continue;
    if (!it.isWordLike && out.length) out[out.length - 1] += seg; // punctuation / symbols attach to the previous word
    else out.push(seg);
  }
  return out;
}

/** Thai words that carry no content for a caption/jump cut (hesitation sounds). Matched on whole words. */
export const FILLERS = new Set(['เอ่อ', 'เออ', 'เอ้อ', 'อ่า', 'อา', 'อืม', 'อึม', 'อ๋อ', 'เอ๊ะ', 'อะ', 'เอิ่ม', 'เออะ', 'อ้า', 'อ่ะ']);
export const isFiller = (w) => FILLERS.has(w.replace(/[\s.,!?…]/g, ''));

/** Approximate spoken weight of a word (syllable-ish): letters without combining marks, min 1. Used to spread time. */
export function spokenWeight(word) {
  let n = 0;
  for (const ch of word) if (!COMBINING.test(ch) && /[\p{L}\p{N}]/u.test(ch)) n++;
  return Math.max(1, n);
}
