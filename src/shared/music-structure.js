// Reads the shape of a song from the audio analysis: which bars are calm, which are full, where the drops are.
// The montage planner cuts fast where the music is full and lets shots breathe where it is calm.
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * @param {{rate:number, rms:ArrayLike<number>, bass:ArrayLike<number>, high:ArrayLike<number>, beats:number[], duration:number}} a  audio analysis (features normalised 0..1)
 * @returns {{bars:Array<{start:number,end:number,energy:number}>, sections:Array<{start:number,end:number,label:string,energy:number}>, drops:number[], energyAt:(t:number)=>number}}
 */
export function musicStructure(a, { barBeats = 4 } = {}) {
  const beats = a.beats || [];
  const total = a.duration;
  // bar boundaries on the beat grid (the file may start before the first beat)
  const edges = [0];
  for (let i = 0; i < beats.length; i += barBeats) if (beats[i] > edges.at(-1) + 0.3) edges.push(beats[i]);
  if (edges.at(-1) < total - 0.3) edges.push(total); else edges[edges.length - 1] = total;
  const mean = (arr, t0, t1) => { const i0 = Math.floor(t0 * a.rate), i1 = Math.max(i0 + 1, Math.ceil(t1 * a.rate)); let s = 0, n = 0; for (let i = i0; i < Math.min(arr.length, i1); i++) { s += arr[i]; n++; } return n ? s / n : 0; };
  const raw = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const t0 = edges[i], t1 = edges[i + 1];
    raw.push(0.5 * mean(a.rms, t0, t1) + 0.3 * mean(a.bass, t0, t1) + 0.2 * mean(a.high, t0, t1));
  }
  // smooth a little, then stretch to 0..1 so quiet and loud songs are both "calm to full"
  const sm = raw.map((_, i) => (raw[Math.max(0, i - 1)] + 2 * raw[i] + raw[Math.min(raw.length - 1, i + 1)]) / 4);
  const sorted = [...sm].sort((x, y) => x - y);
  const lo = sorted[Math.floor(sorted.length * 0.05)] ?? 0, hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 1;
  const span = Math.max(1e-6, hi - lo);
  const bars = sm.map((v, i) => ({ start: edges[i], end: edges[i + 1], energy: clamp01((v - lo) / span) }));

  // drops: a bar that is much fuller than the two before it
  const drops = [];
  for (let i = 1; i < bars.length; i++) {
    const before = (bars[i - 1].energy + (bars[i - 2]?.energy ?? bars[i - 1].energy)) / 2;
    if (bars[i].energy - before >= 0.3 && bars[i].energy >= 0.6 && (!drops.length || bars[i].start - drops.at(-1) > 6)) drops.push(bars[i].start);
  }

  // sections: runs of calm / medium / full bars (at least 2 bars), then named by position and neighbours
  const cls = (e) => (e < 0.35 ? 0 : e < 0.65 ? 1 : 2);
  const runs = [];
  for (const b of bars) {
    const c = cls(b.energy), last = runs.at(-1);
    if (last && last.c === c) { last.end = b.end; last.sum += b.energy; last.n++; } else runs.push({ c, start: b.start, end: b.end, sum: b.energy, n: 1 });
  }
  for (let i = 0; i < runs.length; i++) if (runs[i].n < 2 && runs.length > 1) { const j = i > 0 ? i - 1 : i + 1; runs[j].end = Math.max(runs[j].end, runs[i].end); runs[j].start = Math.min(runs[j].start, runs[i].start); runs[j].sum += runs[i].sum; runs[j].n += runs[i].n; runs.splice(i, 1); i--; }
  const sections = runs.map((r, i) => {
    const e = r.sum / r.n, prev = runs[i - 1], next = runs[i + 1];
    let label;
    if (r.c === 2) label = drops.some((d) => d >= r.start - 0.01 && d < r.end) ? 'drop' : 'peak';
    else if (r.c === 0) label = i === 0 ? 'intro' : i === runs.length - 1 ? 'outro' : 'break';
    else label = next && next.c === 2 && (!prev || prev.c < 2) ? 'build' : i === 0 ? 'intro' : i === runs.length - 1 ? 'outro' : 'verse';
    return { start: r.start, end: r.end, label, energy: e };
  });

  const energyAt = (t) => {
    if (!bars.length) return 0.5;
    for (let i = 0; i < bars.length; i++) if (t < bars[i].end) return bars[i].energy;
    return bars.at(-1).energy;
  };
  return { bars, sections, drops, energyAt };
}
