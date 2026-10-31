// The LIVING tab: a compact workspace for the Living Lab. One section per system, each with a one-line promise.
// This file is only the surface; the work is done by living/controller.js and the modules under it.
import { el } from './dom.js';
import { store } from '../store.js';
import { LivingLabController } from '../living/controller.js';
import { TRACE_MODES } from '../living/human-trace.js';
import { paramSlots } from '/shared/living/slots.js';
import { createEffect } from '/shared/effects-defs.js';
import { normalizeDna, addDna } from '/shared/mutation/dna.js';
import { chainToEffects } from '/shared/mutation/chain.js';
import { collectInputs } from '/shared/living/project-inputs.js';
import { deriveProjectDna, describeIdentity } from '/shared/living/project-dna.js';
import { createLivingLayerClip } from '/shared/living/organism.js';
import { musicStructure } from '/shared/music-structure.js';
import { sampleFeatures } from '/shared/audio-analysis.js';
import { createAdjustClip } from '/shared/adjust-defs.js';
import { projectDuration, addTrack, addClipRaw } from '/shared/timeline.js';

const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export function mountLiving({ preview, runAnalysis, renderer }) {
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

  // ---- MEMORY ----
  const MEM_MODES = [['Ghost', 'Past frames fade into the present.'], ['Stain', 'Colour from earlier frames slowly leaks forward.'], ['Scar', 'Movement leaves a mark that changes slowly.'], ['Echo', 'Fragments of earlier motion return on a rhythm.']];
  const mem = { mode: 0, length: 1.2, intensity: 0.8, blend: 1 };
  const memMode = el('select', { id: 'memory-mode', 'aria-label': 'Memory mode' }, MEM_MODES.map(([l], i) => el('option', { value: i, text: l })));
  const memLine = el('p', { class: 'hint', id: 'memory-line', text: MEM_MODES[0][1] });
  memMode.addEventListener('change', () => { mem.mode = Number(memMode.value); memLine.textContent = MEM_MODES[mem.mode][1]; });
  const memInputs = {};
  const slider = (id, label, min, max, step, key, unit = '') => {
    const input = el('input', { type: 'range', min, max, step, value: mem[key], id, 'aria-label': label });
    const out = el('span', { class: 'mut-out', text: `${mem[key]}${unit}` });
    input.addEventListener('input', () => { mem[key] = Number(input.value); out.textContent = `${input.value}${unit}`; });
    memInputs[key] = { input, out, unit };
    return el('label', { class: 'mut-row' }, el('span', { class: 'liv-axis', text: label }), input, out);
  };
  const memBlend = el('select', { id: 'memory-blend', 'aria-label': 'Memory blend' }, ['Behind (normal)', 'Screen', 'Add', 'Difference'].map((l, i) => el('option', { value: i, text: l, ...(i === mem.blend ? { selected: true } : {}) })));
  memBlend.addEventListener('change', () => { mem.blend = Number(memBlend.value); });
  const memEffect = () => createEffect('memory', { mode: mem.mode, length: mem.length, intensity: mem.intensity, blend: mem.blend });
  const memClip = el('button', { id: 'memory-add-clip', text: 'Add to clip', title: "Adds a Memory Bleed effect to the selected clip's chain (edit it in the Inspector like any effect)", onclick: () => {
    const clip = store.selectedClip;
    if (!clip) { memStatus.textContent = 'Select a clip first.'; return; }
    store.mutate(() => { clip.effects.push(memEffect()); });
    memStatus.textContent = `Memory Bleed added to "${clip.name || clip.type}". Press play: it remembers while the timeline runs.`;
  } });
  const memLayer = el('button', { id: 'memory-add-layer', text: 'Add as layer', title: 'An adjustment layer over the whole project: everything underneath remembers', onclick: () => {
    const dur = projectDuration(store.project);
    if (dur <= 0) { memStatus.textContent = 'Put something on the timeline first.'; return; }
    store.mutate((p) => { const c = createAdjustClip({ name: `Memory Bleed · ${MEM_MODES[mem.mode][0]}`, chain: [{ type: 'memory', params: { mode: mem.mode, length: mem.length, intensity: mem.intensity, blend: mem.blend } }] }, 0, dur); c.trackId = addTrack(p, 'video').id; addClipRaw(p, c); store.select(c.id); });
    memStatus.textContent = 'Memory Bleed layer added over the whole project.';
  } });
  const memStatus = el('p', { class: 'hint', id: 'memory-status' });
  const memQuality = el('p', { class: 'hint', id: 'memory-quality' });

  // ---- DNA ----
  const projectDna = () => normalizeDna(store.project.living?.dna).dna;
  const dnaSeed = el('input', { type: 'number', min: 0, step: 1, value: 1, id: 'dna-seed', 'aria-label': 'Identity seed', title: 'The same project and the same seed always give the same identity' });
  const dnaStatus = el('p', { class: 'hint', id: 'dna-status' });
  const dnaCard = el('div', { class: 'liv-dna', id: 'dna-card' });
  const dnaRead = el('button', { class: 'primary', id: 'dna-read', text: 'Read the project', title: 'Listens to the music on the timeline and looks at the footage you use, then names the identity. Nothing in your edit changes.', onclick: async () => {
    dnaRead.disabled = true;
    try {
      dnaStatus.textContent = 'Listening…';
      if (!store.analysis || store.analysisStale) await runAnalysis({ quiet: true });
      const used = new Set(store.project.clips.filter((c) => c.type === 'media').map((c) => c.mediaId));
      const media = store.project.media.filter((m) => used.has(m.id) && (m.kind === 'video' || m.kind === 'image') && !m.missing);
      let footage = {}, note = '';
      if (media.length) {
        dnaStatus.textContent = `Looking at ${media.length} clip${media.length === 1 ? '' : 's'}…`;
        try { footage = await window.hh.montageAnalyze(media.map((m) => ({ id: m.id, path: m.path, kind: m.kind }))); } catch (e) { note = ` (footage could not be analysed: ${e.message})`; }
      }
      const m = window.__app?.mutateUi?.state;
      const inputs = collectInputs({ project: store.project, analysis: store.analysis, footage, styleBias: m?.style ? { [m.style]: 3 } : {}, mutateSeeds: [m?.seed, ...libSeeds()] });
      const dna = deriveProjectDna(inputs, { seed: Math.floor(Math.abs(Number(dnaSeed.value) || 1)) });
      store.mutate((p) => { p.living = { ...(p.living || {}), dna }; });
      dnaStatus.textContent = `Identity read${note}. It only suggests: nothing is applied until you press a button.`;
    } catch (e) { dnaStatus.textContent = `Could not read the project: ${e.message}`; } finally { dnaRead.disabled = false; }
  } });
  const libSeeds = () => (store.project.dna || []).map((d) => d.seed).filter(Number.isFinite);
  const dnaClear = el('button', { id: 'dna-clear', text: 'Clear', title: 'Forget the project identity', onclick: () => store.mutate((p) => { if (p.living) delete p.living.dna; }) });
  const bar = (v) => el('i', { class: 'liv-bar' }, el('b', { style: `width:${Math.round(v * 100)}%` }));
  function renderDna() {
    dnaCard.replaceChildren();
    const dna = projectDna(), id = dna?.identity;
    if (!id) { dnaCard.append(el('p', { class: 'hint', text: 'No identity yet. Read the project and it gets one: a name, a palette, how it moves, and suggestions for the tools.' })); return; }
    const clip = store.selectedClip;
    dnaCard.append(
      el('h4', { id: 'dna-name', text: id.name }),
      el('div', { class: 'liv-swatches', id: 'dna-palette' }, id.palette.map((c) => el('span', { style: `background:${c}`, title: c }))),
      el('div', { class: 'liv-traits' }, Object.entries(id.traits).map(([k, v]) => el('span', { class: 'liv-trait', title: `${k} ${Math.round(v * 100)}%` }, el('em', { text: k }), bar(v)))),
      el('ul', { class: 'liv-lines' }, describeIdentity(id).map((l) => el('li', { text: l }))),
      el('p', { class: 'hint', text: `Signature look: ${dna.chain.map((c) => c.type).join(' · ')}. Seed ${dna.seed}.` }),
      el('div', { class: 'liv-acts' },
        el('button', { id: 'dna-use-memory', text: 'Use for Memory', title: 'Sets the MEMORY controls above from the identity', onclick: () => applyMemory(id) }),
        el('button', { id: 'dna-use-trace', text: 'Use for Trace', title: 'Sets Smoothing and the trace mode', onclick: () => applyTrace(id) }),
        el('button', { id: 'dna-apply-sig', text: 'Add signature look', disabled: !clip, title: "Adds the signature look's effects to the end of the selected clip's chain (one Undo step)", onclick: () => { store.mutate(() => { clip.effects.push(...chainToEffects(dna.chain)); }); } }),
        el('button', { id: 'dna-layer', text: 'Grow a living layer', disabled: projectDuration(store.project) <= 0, title: 'An adjustment layer over the whole project: veins that grow faster in loud bars, glow with the bass, leave a stain behind. Built from existing effects; edit it like any layer.', onclick: () => {
          const dur = projectDuration(store.project), bars = store.analysis ? musicStructure(store.analysis).bars : null;
          store.mutate((p) => { const c = createLivingLayerClip(id, { start: 0, duration: dur, bars, seed: dna.seed ?? 1 }); c.trackId = addTrack(p, 'video').id; addClipRaw(p, c); store.select(c.id); });
          dnaStatus.textContent = `Living layer added over ${dur.toFixed(1)} s${bars ? ': it grows with the energy of the music' : ' (analyse the music, in the Audio-Reactive tab, and it will grow with it)'}. Undo removes it.`;
        } }),
        el('button', { id: 'dna-save', text: 'Save to library', title: 'Copies it into the DNA library of this project (Mutate tab)', onclick: () => store.mutate((p) => { addDna(p, dna); }) })),
      el('p', { class: 'hint', text: 'In the Mutate tab, tick “lean toward the project\'s identity” to let rolls follow it.' }));
  }
  function applyMemory(id) {
    Object.assign(mem, { mode: id.memory.mode, length: id.memory.length, intensity: id.memory.intensity, blend: id.memory.blend });
    memMode.value = String(mem.mode); memLine.textContent = MEM_MODES[mem.mode][1]; memBlend.value = String(mem.blend);
    for (const [k, { input, out, unit }] of Object.entries(memInputs)) { input.value = mem[k]; mem[k] = Number(input.value); out.textContent = `${mem[k]}${unit}`; } // the slider's own steps decide the value actually used
  }
  function applyTrace(id) {
    ctrl.settings.smooth = id.trace.smoothing; smooth.value = Math.round(id.trace.smoothing * 100); smoothOut.textContent = `${smooth.value}%`;
    ctrl.trace.mode = id.trace.mode; modeSel.value = id.trace.mode; modeSel.dispatchEvent(new Event('change'));
  }

  // ---- ACCIDENT ----
  const acc = ctrl.accident;
  const accStatus = el('p', { class: 'hint', id: 'acc-status', text: 'Select a clip, or two, near a cut or an overlap. Nothing changes until you press Keep.' });
  const accList = el('div', { class: 'liv-acc', id: 'acc-list' });
  let accCanvases = [];
  const accSize = () => { const { width, height } = store.project.settings, k = 320 / Math.max(width, height); return [Math.max(2, Math.round(width * k)), Math.max(2, Math.round(height * k))]; };
  function renderAccidents() {
    accList.replaceChildren(); accCanvases = [];
    const [w, h] = accSize();
    acc.items.forEach((a, i) => {
      const cv = el('canvas', { width: w, height: h }); accCanvases.push(cv);
      accList.append(el('div', { class: 'liv-acc-item', 'data-acc': i, 'data-kind': a.kind },
        cv,
        el('div', {}, el('b', { text: a.title }), el('p', { class: 'hint', text: a.summary }),
          a.preview === 'playback' ? el('p', { class: 'hint liv-dim', text: 'Shows while the timeline plays.' }) : null,
          el('div', { class: 'liv-acts' },
            el('button', { class: 'primary', text: 'Keep', title: 'Applies it to the project (one Undo step)', 'data-acc-keep': i, onclick: () => keepAccident(i) }),
            el('button', { text: 'Reroll', title: 'Another accident of this kind', 'data-acc-reroll': i, onclick: () => { acc.reroll(i); renderAccidents(); paintAccidents(); } })))));
    });
    accUndo.disabled = !acc.lastKept;
  }
  let accTimer = 0;
  function paintAccidents() {
    if (!acc.items.length || store.playing || !pane.classList.contains('on')) return;
    const features = store.project.reactive?.enabled ? sampleFeatures(store.analysis, store.playhead) : null;
    acc.items.forEach((a, i) => {
      if (!accCanvases[i]) return;
      const preview_ = structuredClone(store.project); // the real project is never drawn with an accident in it
      a.apply(preview_);
      try { renderer.paintProject({ project: preview_, sources: preview.sources, t: store.playhead, features, target: accCanvases[i] }); } catch (e) { accStatus.textContent = `Could not draw the preview: ${e.message}`; }
    });
  }
  function keepAccident(i) {
    const summary = acc.items[i]?.summary;
    if (!acc.keep(i)) { accStatus.textContent = 'That accident no longer fits the project. Cause a new one.'; renderAccidents(); return; }
    accStatus.textContent = `Kept: ${summary} Undo takes it back.`;
    renderAccidents();
  }
  const accGo = el('button', { id: 'acc-cause', class: 'primary', text: 'Cause accident', title: 'Plans up to three accidents between clips you have and shows each one. Nothing is applied until you press Keep.', onclick: () => {
    const items = acc.cause();
    if (!items.length) { accStatus.textContent = 'Nothing to break yet: put two clips next to each other (a cut) or one on top of another, or select a clip.'; renderAccidents(); return; }
    accStatus.textContent = `${items.length} accident${items.length === 1 ? '' : 's'}, planned from seed ${items[0].seed}. Keep one, reroll one, or cause new ones.`;
    renderAccidents();
    // the thumbnails show the frame at the playhead: park it by the first accident so they have something to show
    const at = items[0].at;
    if (store.playhead < at - 0.5 || store.playhead > at + 2.5) store.setPlayhead(at + 0.3);
    clearTimeout(accTimer); accTimer = setTimeout(paintAccidents, 350);
  } });
  const accUndo = el('button', { id: 'acc-undo', text: 'Undo last keep', disabled: true, title: 'The editor\'s Undo', onclick: () => { if (acc.undo()) accStatus.textContent = 'Undone.'; renderAccidents(); } });

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
    section('memory', 'MEMORY', 'Let the image remember.',
      el('div', { class: 'mut-row' }, memMode, memBlend), memLine,
      slider('memory-length', 'Length', 0.3, 6, 0.1, 'length', ' s'), slider('memory-intensity', 'Intensity', 0, 1.5, 0.05, 'intensity'),
      el('div', { class: 'mut-row' }, memClip, memLayer), memStatus, memQuality),
    section('dna', 'DNA', 'Give the project a shared identity.',
      el('div', { class: 'mut-row' }, dnaSeed, dnaRead, dnaClear), dnaStatus, dnaCard),
    section('accident', 'ACCIDENT', 'Break the rules carefully.',
      el('div', { class: 'mut-row' }, accGo, accUndo), accStatus, accList),
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
    const m = preview.comp.memory;
    memQuality.textContent = `Memory quality ${Math.round(m.scale * 100)}% of the picture${m.scale < 0.5 ? ' (lowered automatically because playback was stuttering)' : ''}. It builds up while the timeline plays; seeking starts it afresh, exactly as an export from that frame would.${m.overflow ? ' More than ' + 8 + ' memories are in view: the extra ones are passed through.' : ''}`;
    status.textContent = rec ? `Recording ${rec.kind}… ${fmt(Math.max(0, ctrl.clock() - rec.t0))}${rec.kind === 'take' ? ` · ${ctrl.take.rec.touched} parameter${ctrl.take.rec.touched === 1 ? '' : 's'} touched` : ctrl.trace.g ? ` · ${ctrl.trace.g.pts.length} points` : ''} · Esc cancels` : '';
  };
  store.on('living', render);
  store.on('selection', refreshSlots);
  store.on('project', () => { if (!ctrl.busy) { refreshSlots(); renderDna(); if (acc.items.length) { acc.items = []; renderAccidents(); accStatus.textContent = 'The project changed, so those accidents are out of date. Cause new ones.'; } else accUndo.disabled = !acc.lastKept; } });
  store.on('playhead', () => { clearTimeout(accTimer); accTimer = setTimeout(paintAccidents, 120); });
  setInterval(() => { if (ctrl.busy || pane.classList.contains('on')) render(); }, ctrl.busy ? 150 : 700);
  pane.addEventListener('transitionend', drawPad);
  refreshSlots(); render(); drawPad(); renderDna();
  return ctrl;
}
