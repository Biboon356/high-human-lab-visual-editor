// Speed-ramp card: a small graph of playback speed over the clip. Click empty space to add a point, drag points, double-click to remove.
import { el, toast } from './dom.js';
import { store } from '../store.js';
import { rowUpdaters } from './param-row.js';
import { findMedia } from '/shared/project.js';
import { evalTrack } from '/shared/keyframes.js';
import { RAMP_KEY, RAMP_MIN, RAMP_MAX, RAMP_SHAPES, shapeKeys, beatPulseKeys, rampBudget, rampKeys, sourceAdvance } from '/shared/ramp.js';

const W = 300, H = 110, PAD = 8;
const LO = Math.log2(RAMP_MIN), HI = Math.log2(RAMP_MAX);
const yOf = (v) => PAD + ((HI - Math.log2(Math.min(RAMP_MAX, Math.max(RAMP_MIN, v)))) / (HI - LO)) * (H - 2 * PAD);
const vOf = (y) => 2 ** (HI - ((y - PAD) / (H - 2 * PAD)) * (HI - LO));

export function rampCard(clip, lt, card) {
  const media = findMedia(store.project, clip.mediaId);
  const keys = () => clip.keyframes[RAMP_KEY] || (clip.keyframes[RAMP_KEY] = []);
  const xOf = (t) => PAD + (t / Math.max(0.01, clip.duration)) * (W - 2 * PAD);
  const tOf = (x) => Math.min(clip.duration, Math.max(0, ((x - PAD) / (W - 2 * PAD)) * clip.duration));

  const cv = el('canvas', { width: W * 2, height: H * 2, class: 'ramp-graph', style: `width:${W}px;height:${H}px;max-width:100%`, 'data-ramp-graph': '1' });
  const info = el('div', { class: 'hint' });
  const ctx = cv.getContext('2d');

  function draw() {
    const k = rampKeys(clip) || [];
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement), ac = css.getPropertyValue('--accent2').trim() || '#7dffb0', line = css.getPropertyValue('--line').trim() || '#2a332d', dim = css.getPropertyValue('--dim').trim() || '#8a948c';
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.fillStyle = dim; ctx.font = '9px monospace';
    for (const v of [0.25, 0.5, 1, 2, 4]) { ctx.beginPath(); ctx.moveTo(PAD, yOf(v)); ctx.lineTo(W - PAD, yOf(v)); ctx.globalAlpha = v === 1 ? 0.9 : 0.4; ctx.stroke(); ctx.globalAlpha = 1; ctx.fillText(`${v}×`, 2, yOf(v) - 2); }
    ctx.strokeStyle = ac; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= 160; i++) { const t = (i / 160) * clip.duration, x = xOf(t), y = yOf(evalTrack(k.length ? k : null, t, 1)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    const ph = store.playhead - clip.start;
    if (ph >= 0 && ph <= clip.duration) { ctx.strokeStyle = '#fff'; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xOf(ph), PAD); ctx.lineTo(xOf(ph), H - PAD); ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.fillStyle = ac;
    for (const p of k) { ctx.beginPath(); ctx.arc(xOf(p.t), yOf(p.v), 4.5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#0b0f0c'; ctx.lineWidth = 1.2; ctx.stroke(); }
    const b = rampBudget(clip, media?.duration ?? Infinity), used = sourceAdvance(clip, clip.duration);
    info.textContent = k.length
      ? `Shows ${used.toFixed(1)} s of footage in ${clip.duration.toFixed(1)} s (average ${(used / Math.max(0.01, clip.duration * (clip.speed || 1))).toFixed(2)}×). ${b.fits ? '' : `⚠ the file only has ${b.available.toFixed(1)} s left after the in-point — the last frame will hold. `}The clip's own sound is left out while a ramp is on.`
      : 'No ramp: the clip plays at one steady speed. Pick a shape, or click the graph to draw your own.';
  }

  const hit = (x, y) => (rampKeys(clip) || []).findIndex((p) => Math.hypot(xOf(p.t) - x, yOf(p.v) - y) < 9);
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; };

  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const [x, y] = pos(e);
    let i = hit(x, y);
    store.snapshot();
    if (i < 0) { const ks = keys(); ks.push({ t: tOf(x), v: Math.min(RAMP_MAX, Math.max(RAMP_MIN, vOf(y))) }); ks.sort((a, b) => a.t - b.t); i = hit(x, y); if (i < 0) i = ks.findIndex((p) => Math.abs(p.t - tOf(x)) < 1e-6); }
    let p = keys()[i];
    cv.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      const [mx, my] = pos(ev), ks = keys();
      p.t = tOf(mx); p.v = Math.min(RAMP_MAX, Math.max(RAMP_MIN, vOf(my)));
      ks.sort((a, b) => a.t - b.t);
      store.touch('render'); draw();
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); store.touch('project'); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
    store.touch('render'); draw();
  });
  cv.addEventListener('dblclick', (e) => {
    const [x, y] = pos(e), i = hit(x, y);
    if (i < 0) return;
    store.mutate(() => { keys().splice(i, 1); if (!keys().length) delete clip.keyframes[RAMP_KEY]; });
  });

  const shapes = el('select', { 'data-ramp-shape': '1' }, el('option', { value: '', text: 'Shape…' }), Object.keys(RAMP_SHAPES).map((n) => el('option', { value: n, text: n })));
  shapes.addEventListener('change', () => {
    if (!shapes.value) return;
    store.mutate(() => { clip.keyframes[RAMP_KEY] = shapeKeys(shapes.value, clip.duration); });
  });
  const pulse = el('button', { text: 'Pulse on beats', title: 'Fast on every beat, easing down between them (needs music analysed in the Audio-Reactive tab)', 'data-ramp-beats': '1', onclick: () => {
    const beats = store.analysis?.beats;
    const k = beats ? beatPulseKeys(clip, beats) : null;
    if (!k) { toast('No beats under this clip. Analyse the music first (Audio-Reactive tab) and place the clip over it.', 'error'); return; }
    store.mutate(() => { clip.keyframes[RAMP_KEY] = k; });
  } });
  const clear = el('button', { text: 'Clear', 'data-ramp-clear': '1', onclick: () => store.mutate(() => { delete clip.keyframes[RAMP_KEY]; }) });
  draw();
  rowUpdaters.add(draw); // redrawn on every playhead move, cleared with the rest of the Inspector
  return card('Speed ramp', [el('div', { class: 'fx-toolbar' }, shapes, pulse, clear), cv, info]);
}
