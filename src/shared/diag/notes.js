// Usage notes (pure): a few numbers about HOW the editor runs on this computer, so guesses can be replaced by measurements. Off unless the artist turns it on, kept only
// on this computer, and leaves it only as a file the artist chooses to save and send. By design it has NO pictures, NO project content, NO file names or paths, NO text
// the artist typed or said: only counts, timings in buckets, effect names that were on screen, and a few facts about the machine.
export const NOTES_VERSION = 1;
export const FRAME_EDGES = [8, 17, 25, 34, 67, 133]; // ms between two frames while playing; the last bucket is "slower than 133 ms"
export const MAX_BUCKETS = 60, MAX_EXPORTS = 30, MAX_COUNTS = 80, MAX_ERRORS = 30;

export const emptyNotes = (now = 0) => ({ v: NOTES_VERSION, since: now, machine: null, perf: {}, exports: [], counts: {}, errors: {} });

const num = (v, lo, hi, d = 0) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const keyOk = (k) => typeof k === 'string' && /^[a-z0-9._\-]{1,40}$/.test(k);

/** Anything that looks like a path, an address or a long id is replaced; what remains is only the shape of an error message. */
export function scrub(msg) {
  return String(msg ?? '')
    .replace(/(hhlab|file|https?):\/\/[^\s"')]+/gi, '<url>')
    .replace(/[A-Za-z]:\\[^"')\n]*/g, '<path>') // a path may contain spaces: cut up to a quote, a bracket or the end, so no part of a file name is left behind
    .replace(/(^|[\s"'(=])~?\/[^"')\n]*/g, '$1<path>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\s+/g, ' ').trim().slice(0, 100);
}

export function cleanNotes(n) {
  if (!n || typeof n !== 'object' || n.v !== NOTES_VERSION) return emptyNotes(0);
  const out = emptyNotes(num(n.since, 0, 1e15));
  out.machine = n.machine && typeof n.machine === 'object' ? cleanMachine(n.machine) : null;
  for (const [k, b] of Object.entries(n.perf || {}).slice(0, MAX_BUCKETS)) if (/^\d{2,5}x\d{2,5}\|fx\d\|h\d$/.test(k) && b && Array.isArray(b.hist) && b.hist.length === FRAME_EDGES.length + 1) out.perf[k] = { n: Math.floor(num(b.n, 0, 1e9)), hist: b.hist.map((x) => Math.floor(num(x, 0, 1e9))), renderMs: num(b.renderMs, 0, 1e12), maxRender: num(b.maxRender, 0, 1e6) };
  out.exports = (Array.isArray(n.exports) ? n.exports : []).slice(-MAX_EXPORTS).map(cleanExport).filter(Boolean);
  for (const [k, c] of Object.entries(n.counts || {}).slice(0, MAX_COUNTS)) if (keyOk(k)) out.counts[k] = Math.floor(num(c, 0, 1e9));
  for (const [k, c] of Object.entries(n.errors || {}).slice(0, MAX_ERRORS)) out.errors[scrub(k)] = Math.floor(num(c, 0, 1e9));
  return out;
}
const cleanMachine = (m) => ({ app: String(m.app ?? '').slice(0, 20), platform: String(m.platform ?? '').slice(0, 20), arch: String(m.arch ?? '').slice(0, 12), electron: String(m.electron ?? '').slice(0, 20), chrome: String(m.chrome ?? '').slice(0, 20),
  cpus: Math.floor(num(m.cpus, 0, 512)), memGB: Math.floor(num(m.memGB, 0, 4096)), dpr: num(m.dpr, 0, 8, 1), gpu: String(m.gpu ?? '').replace(/[^\w .,()\/+\-:]/g, '').slice(0, 120), software: !!m.software });
const cleanExport = (e) => (e && typeof e === 'object' ? { w: Math.floor(num(e.w, 1, 16384)), h: Math.floor(num(e.h, 1, 16384)), fps: num(e.fps, 1, 240), frames: Math.floor(num(e.frames, 0, 1e7)), seconds: +num(e.seconds, 0, 1e6).toFixed(1), effects: Math.floor(num(e.effects, 0, 99)), heavy: Math.floor(num(e.heavy, 0, 99)), ok: !!e.ok } : null);

export function setMachine(notes, machine) { return { ...notes, machine: cleanMachine(machine || {}) }; }

/** One played frame: how long since the previous one (ms), and how long the drawing call took (ms), under the project's size and how many effects / heavy ones were on screen. */
export function addFrame(notes, { interval, render, w, h, effects, heavy }) {
  if (!Number.isFinite(interval) || interval <= 0 || interval > 5000) return notes;
  const key = `${Math.floor(num(w, 16, 99999, 0))}x${Math.floor(num(h, 16, 99999, 0))}|fx${Math.min(9, Math.floor(num(effects, 0, 99)))}|h${Math.min(9, Math.floor(num(heavy, 0, 99)))}`;
  if (!/^\d{2,5}x\d{2,5}\|fx\d\|h\d$/.test(key)) return notes;
  if (!notes.perf[key] && Object.keys(notes.perf).length >= MAX_BUCKETS) return notes;
  const b = notes.perf[key] || { n: 0, hist: Array(FRAME_EDGES.length + 1).fill(0), renderMs: 0, maxRender: 0 };
  let i = FRAME_EDGES.findIndex((e) => interval < e); if (i < 0) i = FRAME_EDGES.length;
  const r = num(render, 0, 5000);
  return { ...notes, perf: { ...notes.perf, [key]: { n: b.n + 1, hist: b.hist.map((x, k) => (k === i ? x + 1 : x)), renderMs: b.renderMs + r, maxRender: Math.max(b.maxRender, r) } } };
}
export function addExport(notes, e) { const c = cleanExport(e); return c ? { ...notes, exports: [...notes.exports, c].slice(-MAX_EXPORTS) } : notes; }
export function addCount(notes, key) { if (!keyOk(key) || (!(key in notes.counts) && Object.keys(notes.counts).length >= MAX_COUNTS)) return notes; return { ...notes, counts: { ...notes.counts, [key]: (notes.counts[key] || 0) + 1 } }; }
export function addError(notes, msg) { const k = scrub(msg); if (!k) return notes; if (!(k in notes.errors) && Object.keys(notes.errors).length >= MAX_ERRORS) return notes; return { ...notes, errors: { ...notes.errors, [k]: (notes.errors[k] || 0) + 1 } }; }

const pctOf = (hist, q) => { const total = hist.reduce((a, b) => a + b, 0); if (!total) return null; let acc = 0; for (let i = 0; i < hist.length; i++) { acc += hist[i]; if (acc >= q * total) return i < FRAME_EDGES.length ? `<${FRAME_EDGES[i]}` : `>=${FRAME_EDGES[FRAME_EDGES.length - 1]}`; } return null; };

/** The file the artist can send. Every field is listed in `contains`; `neverContains` says what is not in it. */
export function buildReport(notes, now = 0) {
  const perf = Object.entries(notes.perf).map(([bucket, b]) => {
    const [size, fx, h] = bucket.split('|');
    const slow = b.hist.slice(4).reduce((a, x) => a + x, 0); // 34 ms or more between frames: below 30 fps
    return { size, effectsOnScreen: Number(fx.slice(2)), heavyOnScreen: Number(h.slice(1)), frames: b.n, medianFrameMs: pctOf(b.hist, 0.5), p95FrameMs: pctOf(b.hist, 0.95), shareBelow30fps: +(slow / b.n).toFixed(3), avgDrawMs: +(b.renderMs / b.n).toFixed(2), maxDrawMs: +b.maxRender.toFixed(1), histogramEdgesMs: FRAME_EDGES, histogram: b.hist };
  }).sort((a, b) => b.frames - a.frames);
  return { format: 'hhlab-usage-notes', version: NOTES_VERSION, createdAt: now, since: notes.since, machine: notes.machine, playbackByLoad: perf, exports: notes.exports, featureUse: notes.counts, errors: notes.errors,
    contains: ['machine facts (app, system, cpu count, memory, gpu name, screen scale)', 'how smoothly playback ran, in buckets, by project size and how many effects (and heavy ones) were on screen', 'the last exports: size, frame rate, length, how many effects', 'how many times each feature was used', 'error messages with paths and addresses removed'],
    neverContains: ['pictures or video', 'your project, clip names, titles, lyrics or anything you typed or said', 'file names or folders', 'your API key', 'what the online AI was asked or answered'] };
}
