// Human Trace: draw over the picture while the timeline runs; the gesture becomes
//   Motion     keyframes on the selected clip's position
//   Influence  keyframes on any parameters you choose (left–right, up–down, speed)
//   Residue    a new generator clip drawing the line your hand left
//   Grow       a new generator clip whose roots grow along your line
// Motion and Influence write ordinary keyframes; Residue and Grow write a generator clip. Nothing else is stored.
import { el, toast } from '../ui/dom.js';
import { store } from '../store.js';
import { createGesture, beginStroke, addPoint, mapGesture } from '/shared/living/gesture.js';
import { createTraceClip } from '/shared/living/trace-clip.js';
import { punchMerge } from '/shared/living/simplify.js';
import { findSlot } from '/shared/living/slots.js';
import { evalTrack } from '/shared/keyframes.js';
import { addTrack, addClipRaw } from '/shared/timeline.js';
import { newSeed } from '/shared/mutation/rng.js';
import { normalizeDna } from '/shared/mutation/dna.js';

export const TRACE_MODES = [
  ['motion', 'Motion', 'Your hand moves the selected clip.'],
  ['residue', 'Residue', 'Your hand leaves a fading line.'],
  ['influence', 'Influence', 'Your hand steers an effect: across, up and down, and speed.'],
  ['grow', 'Grow', 'Roots grow along your gesture.'],
];

export class HumanTrace {
  constructor(ctrl) {
    this.ctrl = ctrl;
    this.mode = 'motion';
    this.hover = false; // follow the cursor without pressing
    this.map = { x: '', y: '', speed: '' }; // slot ids for Influence
    this.g = null; this.surface = null;
  }

  get active() { return !!this.g; }

  _canvasView(preview) {
    const canvas = document.getElementById('preview'), r = canvas.getBoundingClientRect(), cw = preview.comp.w, ch = preview.comp.h;
    const k = Math.min(r.width / cw, r.height / ch);
    return { left: r.left + (r.width - cw * k) / 2, top: r.top + (r.height - ch * k) / 2, w: cw * k, h: ch * k };
  }

  start() {
    const clip = store.selectedClip;
    const needsClip = this.mode === 'motion' || this.mode === 'influence';
    if (needsClip && (!clip || (clip.type === 'media' && store.project.media.find((m) => m.id === clip.mediaId)?.kind === 'audio'))) { toast('Select a picture, text or shape clip first — Trace will steer it.', 'error'); return false; }
    if (this.mode === 'influence' && !Object.values(this.map).some(Boolean)) { toast('Choose at least one parameter for Across, Up/down or Speed.', 'error'); return false; }
    if (!this.ctrl.begin('trace', { finish: (o) => this._finish(o), cancel: () => this._cancel() })) return false;
    this.g = createGesture();
    this._showSurface();
    return true;
  }

  _showSurface() {
    const wrap = document.getElementById('preview-wrap');
    const canvas = el('canvas', { class: 'trace-canvas' });
    const surface = el('div', { class: 'trace-surface', id: 'trace-surface', title: 'Draw here. Esc cancels, REC again stops.' }, canvas);
    wrap.append(surface);
    this.surface = surface;
    const ctx = canvas.getContext('2d');
    const size = () => { const r = surface.getBoundingClientRect(); canvas.width = r.width; canvas.height = r.height; };
    size();
    let stroke = -1, last = null;
    const to = (e) => { const v = this._canvasView(this.ctrl.preview), r = surface.getBoundingClientRect(); return { u: (e.clientX - v.left) / v.w, v: (e.clientY - v.top) / v.h, x: e.clientX - r.left, y: e.clientY - r.top }; };
    const add = (e) => {
      const p = to(e);
      if (p.u < -0.02 || p.u > 1.02 || p.v < -0.02 || p.v > 1.02) return;
      if (addPoint(this.g, this.ctrl.clock(), p.u, p.v, stroke)) {
        ctx.strokeStyle = 'rgba(125,255,176,.9)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        if (last) { ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
        last = p;
      }
    };
    surface.addEventListener('pointerdown', (e) => { surface.setPointerCapture(e.pointerId); stroke = beginStroke(this.g); last = null; add(e); });
    surface.addEventListener('pointermove', (e) => { if (stroke >= 0 && e.buttons) { for (const c of e.getCoalescedEvents?.() || [e]) add(c); } else if (this.hover) { if (stroke < 0 || !e.buttons) { if (this._hoverStroke !== this.g.strokes) this._hoverStroke = (stroke = beginStroke(this.g)); add(e); } } });
    surface.addEventListener('pointerup', () => { stroke = -1; last = null; this._hoverStroke = null; });
    // the live line fades so a long take does not fill the screen
    this._fade = setInterval(() => { ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,.06)'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.globalCompositeOperation = 'source-over'; }, 80);
  }

  _hideSurface() { clearInterval(this._fade); this.surface?.remove(); this.surface = null; }

  _cancel() { this._hideSurface(); this.g = null; }

  _finish({ tEnd }) {
    this._hideSurface();
    const g = this.g; this.g = null;
    if (!g.pts.length) return { noop: true, text: 'No gesture was drawn.' };
    const clip = store.selectedClip, aspect = this.ctrl.preview.comp.w / this.ctrl.preview.comp.h, curve = this.ctrl.curve();
    const seconds = (g.pts.at(-1)[0] - g.pts[0][0]).toFixed(1);
    if (this.mode === 'residue' || this.mode === 'grow') {
      const c = createTraceClip(g, { mode: this.mode, seed: newSeed() % 1000, tail: Math.max(1, tEnd - g.pts.at(-1)[0] + 0.5), identity: normalizeDna(store.project.living?.dna).dna?.identity || null });
      const p = store.project;
      c.trackId = addTrack(p, 'video').id;
      addClipRaw(p, c);
      store.select(c.id);
      return { text: `${this.mode === 'grow' ? 'Roots grow' : 'Residue drawn'} along ${seconds} s of gesture — a new generator clip. Edit it in the Inspector; its path keeps your timing.` };
    }
    const t0 = g.pts[0][0];
    let mappings;
    if (this.mode === 'motion') {
      const x0 = evalTrack(clip.keyframes.x, t0 - clip.start, clip.props.x), y0 = evalTrack(clip.keyframes.y, t0 - clip.start, clip.props.y);
      const u0 = g.pts[0][1], v0 = g.pts[0][2];
      mappings = [
        { owner: clip, key: 'x', offset: clip.start, axis: 'x', fn: (u) => x0 + (u - u0), range: [-1, 1] }, // relative: the clip follows how far your hand moved
        { owner: clip, key: 'y', offset: clip.start, axis: 'y', fn: (v) => y0 - (v - v0), range: [-1, 1] },
      ];
    } else {
      mappings = [];
      for (const [axis, id] of Object.entries(this.map)) {
        const slot = id && findSlot(clip, id);
        if (!slot) continue;
        const { min, max } = slot.def;
        mappings.push({ owner: slot.owner, key: slot.key, offset: clip.start, axis, range: [min, max], fn: axis === 'y' ? (v) => max - v * (max - min) : (v) => min + v * (max - min) });
      }
    }
    const out = mapGesture(g, mappings, { ...curve, aspect });
    let keys = 0;
    for (const o of out) { o.owner.keyframes ||= {}; o.owner.keyframes[o.key] = punchMerge(o.owner.keyframes[o.key], o.track, o.t0, o.t1); keys += o.track.length; }
    return { text: `${this.mode === 'motion' ? 'Motion' : 'Influence'} kept: ${seconds} s of gesture → ${out.length} track${out.length === 1 ? '' : 's'}, ${keys} keyframes on "${clip.name || clip.type}". Ordinary keyframes — edit them in the Inspector.` };
  }
}
