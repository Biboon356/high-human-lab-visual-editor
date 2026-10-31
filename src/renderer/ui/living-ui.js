// The LIVING tab: a compact workspace for the Living Lab. One section per system, each with a one-line promise.
// This file is only the surface; the work is done by living/controller.js and the modules under it.
import { el } from './dom.js';
import { store } from '../store.js';
import { LivingLabController } from '../living/controller.js';
import { TRACE_MODES } from '../living/human-trace.js';
import { paramSlots } from '/shared/living/slots.js';

const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export function mountLiving({ preview }) {
  const ctrl = new LivingLabController({ preview });
  const root = document.getElementById('living-root');
  const pane = root.closest('.pane');
  const section = (id, title, line, ...kids) => el('section', { class: 'liv-sec', id: `living-${id}` }, el('h3', {}, title, el('em', { text: line })), ...kids);

  // ---- shared: smoothing, last result ----
  const smooth = el('input', { type: 'range', min: 0, max: 100, step: 1, value: Math.round(ctrl.settings.smooth * 100), id: 'living-smooth', 'aria-label': 'Smoothing' });
  const smoothOut = el('span', { class: 'mut-out', text: `${smooth.value}%` });
  smooth.addEventListener('input', () => { ctrl.settings.smooth = Number(smooth.value) / 100; smoothOut.textContent = `${smooth.value}%`; });
  const result = el('p', { class: 'hint liv-result', id: 'living-result' });
  const slotsFor = () => paramSlots(store.selectedClip);
  const slotOptions = (sel, current) => {
    const slots = slotsFor();
    sel.replaceChildren(el('option', { value: '', text: '— none —' }), ...slots.map((s) => el('option', { value: s.id, text: s.label, ...(s.id === current ? { selected: true } : {}) })));
  };

  // ---- TRACE ----
  const modeSel = el('select', { id: 'trace-mode', 'aria-label': 'Trace mode' }, TRACE_MODES.map(([v, l]) => el('option', { value: v, text: l })));
  const modeLine = el('p', { class: 'hint', id: 'trace-line', text: TRACE_MODES[0][2] });
  const mapSels = {};
  const infl = el('div', { class: 'liv-infl', id: 'trace-influence', hidden: true },
    ...[['x', 'Across'], ['y', 'Up / down'], ['speed', 'Speed']].map(([axis, label]) => {
      const sel = el('select', { 'data-trace-map': axis, 'aria-label': label });
      sel.addEventListener('change', () => { ctrl.trace.map[axis] = sel.value; });
      mapSels[axis] = sel;
      return el('label', { class: 'mut-row' }, el('span', { class: 'liv-axis', text: label }), sel);
    }));
  modeSel.addEventListener('change', () => { ctrl.trace.mode = modeSel.value; modeLine.textContent = TRACE_MODES.find((m) => m[0] === modeSel.value)[2]; infl.hidden = modeSel.value !== 'influence'; refreshSlots(); });
  const hover = el('input', { type: 'checkbox', id: 'trace-hover' });
  hover.addEventListener('change', () => { ctrl.trace.hover = hover.checked; });
  const traceRec = el('button', { class: 'liv-rec', id: 'trace-rec', text: '● REC', title: 'Plays the timeline; draw over the picture. REC again keeps it, Esc throws it away.', onclick: () => { if (ctrl.session?.kind === 'trace') ctrl.end(); else ctrl.trace.start(); } });

  // ---- TAKE ----
  const takeRec = el('button', { class: 'liv-rec', id: 'take-rec', text: '● REC', title: 'Plays the timeline; move any Inspector slider or the pad. REC again keeps it, Esc throws it away.', onclick: () => { if (ctrl.session?.kind === 'take') ctrl.end(); else ctrl.take.start(); } });
  const padSel = { x: el('select', { id: 'pad-x', 'aria-label': 'Pad across' }), y: el('select', { id: 'pad-y', 'aria-label': 'Pad up and down' }) };
  const pad = el('canvas', { class: 'liv-pad', id: 'take-pad', width: 480, height: 300, 'aria-label': 'XY pad' });
  const pctx = pad.getContext('2d');
  const padState = { u: 0.5, v: 0.5, down: false };
  const drawPad = () => {
    const css = getComputedStyle(document.documentElement), ac = css.getPropertyValue('--accent2').trim() || '#7dffb0', line = css.getPropertyValue('--line').trim() || '#2a332d';
    pctx.clearRect(0, 0, pad.width, pad.height);
    pctx.strokeStyle = line; pctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { pctx.beginPath(); pctx.moveTo((pad.width * i) / 4, 0); pctx.lineTo((pad.width * i) / 4, pad.height); pctx.moveTo(0, (pad.height * i) / 4); pctx.lineTo(pad.width, (pad.height * i) / 4); pctx.stroke(); }
    const x = padState.u * pad.width, y = padState.v * pad.height;
    pctx.strokeStyle = ac; pctx.fillStyle = ac;
    pctx.beginPath(); pctx.moveTo(x, 0); pctx.lineTo(x, pad.height); pctx.moveTo(0, y); pctx.lineTo(pad.width, y); pctx.stroke();
    pctx.beginPath(); pctx.arc(x, y, padState.down ? 11 : 7, 0, Math.PI * 2); pctx.fill();
  };
  const padMove = (e) => {
    const r = pad.getBoundingClientRect();
    padState.u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); padState.v = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const slots = slotsFor();
    const sx = slots.find((s) => s.id === padSel.x.value), sy = slots.find((s) => s.id === padSel.y.value);
    if (sx) ctrl.take.perform(sx, sx.def.min + padState.u * (sx.def.max - sx.def.min));
    if (sy) ctrl.take.perform(sy, sy.def.max - padState.v * (sy.def.max - sy.def.min)); // up = more
    drawPad();
  };
  pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); padState.down = true; if (!store.recorder?.active) store.snapshot(); padMove(e); });
  pad.addEventListener('pointermove', (e) => { if (padState.down) for (const c of e.getCoalescedEvents?.() || [e]) padMove(c); });
  pad.addEventListener('pointerup', () => { padState.down = false; drawPad(); if (!store.recorder?.active) store.touch('project', 'keyframes'); });

  const status = el('p', { class: 'hint liv-status', id: 'living-status' });

  root.append(
    el('div', { class: 'mut-controls' }, el('label', { class: 'mut-row', title: 'How much a performance is simplified: more smoothing, fewer and calmer keyframes. The timing of your hand is kept either way.' }, 'Smoothing', smooth, smoothOut)),
    section('trace', 'TRACE', 'Leave your hand inside the edit.',
      el('div', { class: 'mut-row' }, modeSel, traceRec), modeLine, infl,
      el('label', { class: 'mut-row chk' }, hover, 'follow the cursor without pressing')),
    section('take', 'TAKE', 'Perform your visual live.',
      el('div', { class: 'mut-row' }, el('span', { class: 'hint', text: 'Move Inspector sliders, or the pad, while it plays.' }), takeRec),
      pad,
      el('div', { class: 'liv-padsel' }, el('label', {}, 'Across', padSel.x), el('label', {}, 'Up / down', padSel.y))),
    status, result);

  function refreshSlots() {
    const keep = { px: padSel.x.value, py: padSel.y.value };
    slotOptions(padSel.x, keep.px); slotOptions(padSel.y, keep.py);
    for (const [axis, sel] of Object.entries(mapSels)) { slotOptions(sel, ctrl.trace.map[axis]); ctrl.trace.map[axis] = sel.value; }
    if (!padSel.x.value) { const first = slotsFor().find((s) => s.key === 'x' && s.id.startsWith('clip.')); if (first) padSel.x.value = first.id; }
    if (!padSel.y.value) { const first = slotsFor().find((s) => s.key === 'y' && s.id.startsWith('clip.')); if (first) padSel.y.value = first.id; }
  }

  const render = () => {
    const rec = ctrl.session;
    for (const [btn, kind] of [[traceRec, 'trace'], [takeRec, 'take']]) {
      const mine = rec?.kind === kind;
      btn.classList.toggle('on', mine); btn.textContent = mine ? '■ STOP' : '● REC'; btn.disabled = !!rec && !mine;
    }
    result.textContent = ctrl.last?.text || '';
    status.textContent = rec ? `Recording ${rec.kind}… ${fmt(Math.max(0, ctrl.clock() - rec.t0))}${rec.kind === 'take' ? ` · ${ctrl.take.rec.touched} parameter${ctrl.take.rec.touched === 1 ? '' : 's'} touched` : ctrl.trace.g ? ` · ${ctrl.trace.g.pts.length} points` : ''} · Esc cancels` : '';
  };
  store.on('living', render);
  store.on('selection', refreshSlots);
  store.on('project', () => { if (!ctrl.busy) refreshSlots(); });
  setInterval(() => { if (ctrl.busy) render(); }, 150);
  pane.addEventListener('transitionend', drawPad);
  refreshSlots(); render(); drawPad();
  return ctrl;
}
