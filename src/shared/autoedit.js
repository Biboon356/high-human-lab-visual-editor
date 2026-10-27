// Planning helpers for the one-click TikTok edit. All pure and unit-tested; the renderer applies the plans to the project.

/** Percentile of an array-like (0..1). */
function percentile(arr, p) {
  const a = Float32Array.from(arr).sort();
  return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
}

/**
 * Speech segments from an amplitude envelope.
 * @param {{rate:number, rms:ArrayLike<number>}} env  rms is any non-negative level per frame
 * @returns {Array<{start:number,end:number}>} seconds, padded, merged across gaps shorter than minSilence
 */
export function detectSpeech(env, { minSilence = 0.35, minSpeech = 0.12, pad = 0.08, sensitivity = 0.5 } = {}) {
  const { rate, rms } = env;
  if (!rms.length) return [];
  const floor = percentile(rms, 0.15), peak = percentile(rms, 0.97);
  if (peak - floor < 1e-4) return [];
  // sensitivity 0..1: higher = counts quieter sound as speech
  const thr = floor + (peak - floor) * (0.28 - 0.2 * sensitivity);
  const raw = [];
  let open = -1;
  for (let i = 0; i < rms.length; i++) {
    const on = rms[i] > thr;
    if (on && open < 0) open = i;
    if (!on && open >= 0) { raw.push([open / rate, i / rate]); open = -1; }
  }
  if (open >= 0) raw.push([open / rate, rms.length / rate]);
  const merged = [];
  for (const r of raw) {
    const last = merged.at(-1);
    if (last && r[0] - last[1] < minSilence) last[1] = r[1]; else merged.push([...r]);
  }
  const total = rms.length / rate;
  const kept = merged.filter(([a, b]) => b - a >= minSpeech).map(([a, b]) => [Math.max(0, a - pad), Math.min(total, b + pad)]);
  // padding can make neighbours touch: merge them back
  const out = [];
  for (const r of kept) { const last = out.at(-1); if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else out.push(r); }
  return out.map(([start, end]) => ({ start, end }));
}

/** Removes `cuts` from `keep` (both sorted-or-not arrays of {start,end}); returns sorted non-empty ranges. */
export function subtractRanges(keep, cuts, minLen = 0.05) {
  let cur = keep.map((r) => ({ ...r })).sort((a, b) => a.start - b.start);
  for (const c of [...cuts].sort((a, b) => a.start - b.start)) {
    const next = [];
    for (const r of cur) {
      if (c.end <= r.start || c.start >= r.end) { next.push(r); continue; }
      if (c.start > r.start) next.push({ start: r.start, end: c.start });
      if (c.end < r.end) next.push({ start: c.end, end: r.end });
    }
    cur = next;
  }
  return cur.filter((r) => r.end - r.start >= minLen);
}

/**
 * Builds the source->edited time map for a list of kept ranges laid back-to-back.
 * @returns {{segments:Array<{src0:number,src1:number,dst0:number}>, duration:number, map:(t:number)=>number|null, mapNearest:(t:number)=>number}}
 */
export function buildTimeMap(keep) {
  const segments = [];
  let dst = 0;
  for (const r of keep) { segments.push({ src0: r.start, src1: r.end, dst0: dst }); dst += r.end - r.start; }
  const find = (t) => segments.find((s) => t >= s.src0 - 1e-9 && t <= s.src1 + 1e-9);
  return {
    segments,
    duration: dst,
    /** edited time of a source time, or null if that moment was cut */
    map: (t) => { const s = find(t); return s ? s.dst0 + (t - s.src0) : null; },
    /** like map, but a cut moment snaps to the nearest kept boundary */
    mapNearest: (t) => {
      const s = find(t);
      if (s) return s.dst0 + (t - s.src0);
      let best = 0, bd = Infinity;
      for (const g of segments) for (const [src, d] of [[g.src0, g.dst0], [g.src1, g.dst0 + (g.src1 - g.src0)]]) { const dd = Math.abs(src - t); if (dd < bd) { bd = dd; best = d; } }
      return best;
    },
  };
}

/**
 * Carries timed words through an edit; words inside a cut are dropped, partly-cut words are clipped.
 */
export function remapWords(words, timeMap) {
  const out = [];
  for (const w of words) {
    const seg = timeMap.segments.find((s) => w.end > s.src0 && w.start < s.src1);
    if (!seg) continue;
    const a = Math.max(w.start, seg.src0), b = Math.min(w.end, seg.src1);
    out.push({ ...w, start: seg.dst0 + (a - seg.src0), end: seg.dst0 + (b - seg.src0) });
  }
  return out;
}

/** Scale (relative to the contain-fit the compositor already applies) needed to fill/fit the canvas. */
export function planReframe({ srcW, srcH, dstW, dstH, mode = 'fill' }) {
  const fit = Math.min(dstW / srcW, dstH / srcH), fill = Math.max(dstW / srcW, dstH / srcH);
  if (mode === 'fill') return { scale: fill / fit, background: false };
  if (mode === 'blurfit') return { scale: 1, background: true, backgroundScale: fill / fit };
  return { scale: 1, background: false };
}

/** Alternating punch-in levels that hide jump cuts (every second cut is slightly tighter). */
export function punchLevels(count, { tight = 1.12, loose = 1.0 } = {}) {
  return Array.from({ length: count }, (_, i) => (i % 2 === 1 ? tight : loose));
}

/** Words that are noticeably louder than the rest (top fraction by peak level), at least `minChars` wide. */
export function loudWords(words, env, { fraction = 0.12, minChars = 2 } = {}) {
  if (!env?.rms?.length || !words.length) return [];
  const peaks = words.map((w) => {
    let m = 0;
    for (let i = Math.max(0, Math.floor(w.start * env.rate)); i <= Math.min(env.rms.length - 1, Math.ceil(w.end * env.rate)); i++) m = Math.max(m, env.rms[i]);
    return m;
  });
  const cutoff = percentile(peaks, 1 - fraction);
  return words.filter((w, i) => peaks[i] >= cutoff && peaks[i] > 0 && [...w.text].length >= minChars);
}
