// Pure audio analysis (no Node/DOM deps): amplitude envelope, 3 band energies, and
// beat/onset detection via spectral flux. Swap or extend `analyze` for richer analysis.
const FFT_SIZE = 1024;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

function normalize(arr) {
  const sorted = Float32Array.from(arr).sort();
  const p = sorted[Math.floor(sorted.length * 0.98)] || 1e-9;
  const k = 1 / Math.max(p, 1e-9);
  for (let i = 0; i < arr.length; i++) arr[i] = Math.min(1, arr[i] * k);
}

/**
 * @param pcm        Float32Array mono samples
 * @param sampleRate Hz
 * @param featureRate analysis frames per second (default 60)
 * @returns {{rate:number, duration:number, rms:Float32Array, bass:Float32Array, mid:Float32Array,
 *            high:Float32Array, beat:Float32Array, beats:number[], bpm:number|null}}
 */
export function analyze(pcm, sampleRate, featureRate = 60) {
  const hop = Math.max(1, Math.round(sampleRate / featureRate));
  const frames = Math.max(1, Math.floor(pcm.length / hop));
  const rms = new Float32Array(frames), bass = new Float32Array(frames);
  const mid = new Float32Array(frames), high = new Float32Array(frames);
  const flux = new Float32Array(frames);
  const re = new Float32Array(FFT_SIZE), im = new Float32Array(FFT_SIZE);
  const win = new Float32Array(FFT_SIZE).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  const binHz = sampleRate / FFT_SIZE;
  const bassEnd = Math.max(1, Math.floor(200 / binHz));
  const midEnd = Math.max(bassEnd + 1, Math.floor(2000 / binHz));
  const nyq = FFT_SIZE / 2;
  let prev = new Float32Array(nyq);

  for (let f = 0; f < frames; f++) {
    const s0 = f * hop;
    let sum = 0;
    const len = Math.min(hop, pcm.length - s0);
    for (let i = 0; i < len; i++) sum += pcm[s0 + i] * pcm[s0 + i];
    rms[f] = Math.sqrt(sum / Math.max(1, len));

    const c = s0 + (hop >> 1) - (FFT_SIZE >> 1);
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = c + i;
      re[i] = idx >= 0 && idx < pcm.length ? pcm[idx] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    let b = 0, m = 0, h = 0, fl = 0;
    const mag = new Float32Array(nyq);
    for (let k = 1; k < nyq; k++) {
      const a = Math.hypot(re[k], im[k]) / FFT_SIZE;
      mag[k] = a;
      if (k < bassEnd) b += a; else if (k < midEnd) m += a; else h += a;
      const d = Math.log1p(100 * a) - Math.log1p(100 * prev[k]);
      if (d > 0) fl += d;
    }
    prev = mag;
    bass[f] = b; mid[f] = m / Math.max(1, midEnd - bassEnd) * 6; high[f] = h / Math.max(1, nyq - midEnd) * 12;
    flux[f] = fl;
  }

  // Peak-pick onsets with an adaptive threshold (local mean * 1.5 + floor).
  const beats = [];
  const W = Math.round(featureRate * 0.5);
  const minGap = Math.round(featureRate * 0.2);
  let last = -minGap;
  const fluxMax = flux.reduce((a, v) => Math.max(a, v), 0);
  for (let f = 1; f < frames - 1; f++) {
    let mean = 0, n = 0;
    for (let j = Math.max(0, f - W); j < Math.min(frames, f + W); j++) { mean += flux[j]; n++; }
    mean /= n;
    if (flux[f] > flux[f - 1] && flux[f] >= flux[f + 1] && flux[f] > mean * 1.5 + fluxMax * 0.05 && f - last >= minGap) {
      beats.push(f / featureRate);
      last = f;
    }
  }

  // Beat envelope: instant attack, 0.25s exponential release.
  const beat = new Float32Array(frames);
  const decay = Math.exp(-1 / (featureRate * 0.25));
  let bi = 0, env = 0;
  for (let f = 0; f < frames; f++) {
    if (bi < beats.length && Math.round(beats[bi] * featureRate) <= f) { env = 1; bi++; }
    beat[f] = env;
    env *= decay;
  }

  // Tempo estimate from median inter-beat interval (only if enough beats).
  let bpm = null;
  if (beats.length >= 4) {
    const iv = beats.slice(1).map((t, i) => t - beats[i]).sort((a, b) => a - b);
    let med = iv[Math.floor(iv.length / 2)];
    if (med > 0) { bpm = 60 / med; while (bpm < 70) bpm *= 2; while (bpm > 180) bpm /= 2; bpm = Math.round(bpm * 10) / 10; }
  }

  for (const a of [rms, bass, mid, high]) normalize(a);
  return { rate: featureRate, duration: pcm.length / sampleRate, rms, bass, mid, high, beat, beats, bpm };
}

/** Feature snapshot at project time t (linear interpolation). Returns null if no analysis. */
export function sampleFeatures(a, t) {
  if (!a) return null;
  const x = Math.max(0, t) * a.rate;
  const i = Math.min(a.rms.length - 1, Math.floor(x));
  const j = Math.min(a.rms.length - 1, i + 1);
  const u = x - Math.floor(x);
  const lerp = (arr) => arr[i] + (arr[j] - arr[i]) * u;
  return { rms: lerp(a.rms), bass: lerp(a.bass), mid: lerp(a.mid), high: lerp(a.high), beat: a.beat[i] };
}
