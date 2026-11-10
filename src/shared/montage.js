// Beat-synced auto-montage planner. Pure: turns beat times + available media into a list of timeline segments.
// Deterministic for a given seed, so results can be reproduced (and unit-tested).

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * @param {{beats:number[], every:number, total:number, media:{id:string,kind:string,duration:number}[], seed?:number, minSegment?:number}} o
 * @returns {{start:number, duration:number, mediaId:string, in:number}[]} contiguous segments from 0 to `total`
 */
export function planMontage({ beats, every = 2, total, media, seed = 1, minSegment = 0.25 }) {
  const usable = media.filter((m) => m.kind === 'video' || m.kind === 'image');
  if (!usable.length || !(total > 0)) return [];
  const bounds = [0];
  beats.forEach((b, i) => { if (i % every === 0 && b > bounds[bounds.length - 1] + minSegment && b < total - minSegment) bounds.push(b); });
  bounds.push(total);

  const rand = rng(seed);
  const shuffled = () => { const a = usable.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  let bag = [];
  const out = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    let duration = bounds[i + 1] - start;
    if (!bag.length) bag = shuffled();
    // prefer the next media long enough for this segment; fall back to the longest and shorten the segment
    let k = bag.findIndex((m) => m.kind === 'image' || m.duration >= duration);
    if (k < 0) k = bag.reduce((best, m, idx) => (m.duration > bag[best].duration ? idx : best), 0);
    const m = bag.splice(k, 1)[0];
    let inPoint = 0;
    if (m.kind === 'video') {
      duration = Math.min(duration, m.duration);
      inPoint = Math.round(rand() * Math.max(0, m.duration - duration) * 100) / 100; // random in-point so repeats differ
    }
    out.push({ start, duration, mediaId: m.id, in: inPoint });
  }
  // when a short source shortened its segment, keep the sequence gapless by sliding later segments earlier
  let t = 0;
  for (const seg of out) { seg.start = t; t += seg.duration; }
  return out;
}
