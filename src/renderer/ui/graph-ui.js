// Graph tab: the selected clip's effect chain drawn as boxes and wires, with the audio links as wires from loudness / bass / mids / highs / beats
// to the exact parameter they move. By default it only DRAWS what is already in the project; while a PREVIEW is showing it draws the preview and
// marks what is new, so a plan can be understood as a picture before it is applied. Clicking an effect jumps to its card in the Inspector.
// "Edit the graph" (off by default) lets you change the real project from the picture: run an effect earlier or later, switch it off, remove it, drag from a signal
// onto a parameter to make it follow the music, set how strongly or remove a link. Each change is one Undo step and goes through the same data as the Inspector.
import { store } from '../store.js';
import { el } from './dom.js';
import { buildGraph, describeGraph, GEOM } from '/shared/graph/layout.js';
import { liveGraph } from '/shared/graph/live.js';
import { moveEffect, setEffectEnabled, removeEffect, bindParam, setBindingAmount, unbindParam, bindableParams } from '/shared/graph/edit.js';
import { SIGNAL_LABELS } from '/shared/graph/layout.js';
import { diag } from '../diag.js';
import { sampleFeatures } from '/shared/audio-analysis.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : String(v)); for (const k of kids) if (k != null) n.append(k); return n; };
const txt = (s) => document.createTextNode(String(s));

export function mountGraph(root) {
  const caption = el('p', { class: 'hint pad', id: 'graph-caption' });
  const note = el('p', { class: 'hint pad graph-note', id: 'graph-live-note' });
  const edit = el('input', { type: 'checkbox', id: 'graph-edit' });
  const editRow = el('label', { class: 'chk graph-editrow', title: 'Change the clip from the picture: reorder, switch off, remove, drag a signal onto a parameter. Off by default: the graph then only shows.' }, edit, 'Edit the graph');
  const tools = el('div', { class: 'graph-tools', id: 'graph-tools', hidden: true });
  const holder = el('div', { class: 'graph-holder', id: 'graph-holder' });
  const legend = el('p', { class: 'hint pad graph-legend', text: 'Boxes are the effects in the order they run, top to bottom. A line from the left is a parameter following the music (the number is how strongly; a minus means opposite). ● follows music · ∿ animated by keyframes · new = only in the preview · heavy = a demanding effect (the editor\'s own estimate, not measured on your computer). While you play, the lines and numbers move with the sound.' });
  root.append(el('header', { class: 'pane-head' }, el('h2', { text: 'Graph' }), el('span', { text: 'See the chain and what follows the music' })), caption, el('div', { class: 'pad' }, editRow), note, holder, tools, legend);

  function clips() {
    const id = store.selection; if (!id) return { clip: null, base: null };
    const real = store.project.clips.find((c) => c.id === id) || null;
    if (store.ghost) { const g = store.ghost.clips.find((c) => c.id === id); if (g) return { clip: g, base: real }; }
    return { clip: real, base: null };
  }

  let lastGraph = null, vals = new Map(), wiresEl = new Map(), sigs = new Map();
  let selectedWire = null, targetSel = 'clip';
  const realClip = () => store.project.clips.find((c) => c.id === store.selection) || null;
  const editable = () => edit.checked && !store.ghost && !!realClip();
  /** One Undo step per change, and none when the change would do nothing (the operation is tried on a copy first). */
  function tryEdit(op) {
    const id = store.selection; if (!id || store.ghost) return false;
    const probe = structuredClone(store.project); if (!op(probe, id)) return false;
    store.mutate((p) => op(p, id)); diag.count('graph.edit'); return true;
  }
  const effectTargetId = (nodeId) => (nodeId === 'clip' ? 'clip' : nodeId);
  function act(kind, nodeId, idx, count) {
    if (kind === 'up') tryEdit((p, id) => moveEffect(p, id, nodeId, idx - 1));
    else if (kind === 'down') tryEdit((p, id) => moveEffect(p, id, nodeId, idx + 1));
    else if (kind === 'toggle') tryEdit((p, id) => { const fx = p.clips.find((c) => c.id === id)?.effects.find((e) => e.id === nodeId); return fx ? setEffectEnabled(p, id, nodeId, fx.enabled === false) : false; });
    else if (kind === 'remove') tryEdit((p, id) => removeEffect(p, id, nodeId));
  }
  const bindNow = (nodeId, key, source) => { if (tryEdit((p, id) => bindParam(p, id, effectTargetId(nodeId), key, source))) selectedWire = { node: nodeId, key }; };

  // the panel under the picture: set the strength of the chosen link, or add a link for a parameter that has no row on the picture
  function renderTools(clip, canEdit) {
    tools.replaceChildren(); tools.hidden = !edit.checked;
    if (!edit.checked) return;
    if (!canEdit) { tools.append(el('p', { class: 'hint', text: store.ghost ? 'A PREVIEW is showing: apply or cancel it, then edit.' : 'Select a clip to edit its graph.' })); return; }
    const owner = (id) => (id === 'clip' ? clip : clip.effects.find((e) => e.id === id));
    if (selectedWire && !owner(selectedWire.node)?.bindings?.[selectedWire.key]) selectedWire = null;
    if (selectedWire) {
      const o = owner(selectedWire.node), b = o.bindings[selectedWire.key];
      const pname = bindableParams(clip, selectedWire.node).find((x) => x.key === selectedWire.key)?.label || selectedWire.key;
      const amt = el('input', { type: 'range', id: 'graph-amt', min: -1, max: 1, step: 0.05, value: b.amount }), shown = el('b', { id: 'graph-amt-val', text: String(+b.amount.toFixed(2)) });
      amt.addEventListener('input', () => { shown.textContent = String(+Number(amt.value).toFixed(2)); });
      amt.addEventListener('change', () => { const n = selectedWire; tryEdit((p, id) => setBindingAmount(p, id, effectTargetId(n.node), n.key, Number(amt.value))); });
      tools.append(el('div', { class: 'graph-wirebox', id: 'graph-wirebox' }, el('p', { class: 'hint', text: `${pname} ← ${SIGNAL_LABELS[b.source]}: how strongly (a minus is the opposite)` }), el('div', { class: 'cmd-row' }, amt, shown, el('button', { id: 'graph-unlink', text: 'Remove link', onclick: () => { const n = selectedWire; selectedWire = null; tryEdit((p, id) => unbindParam(p, id, effectTargetId(n.node), n.key)); } }))));
    }
    const targets = [{ id: 'clip', label: `The clip (${clip.name || 'clip'})` }, ...clip.effects.map((e, i) => ({ id: e.id, label: `${i + 1}. ${e.type}` }))];
    if (!targets.some((t) => t.id === targetSel)) targetSel = 'clip';
    const tSel = el('select', { id: 'graph-add-target', 'aria-label': 'Which effect' }, ...targets.map((t) => el('option', { value: t.id, text: t.label })));
    const pSel = el('select', { id: 'graph-add-param', 'aria-label': 'Which parameter' });
    const sSel = el('select', { id: 'graph-add-signal', 'aria-label': 'Which sound' }, ...Object.entries(SIGNAL_LABELS).map(([k, l]) => el('option', { value: k, text: l })));
    const fill = () => pSel.replaceChildren(...bindableParams(clip, tSel.value).map((x) => el('option', { value: x.key, text: x.label })));
    tSel.value = targetSel; fill();
    tSel.addEventListener('change', () => { targetSel = tSel.value; fill(); });
    tools.append(el('div', { class: 'graph-addbox' }, el('p', { class: 'hint', text: 'Add a link for any parameter (also the ones with no row above):' }), el('div', { class: 'cmd-row' }, tSel, pSel, sSel, el('button', { id: 'graph-add-go', text: 'Add link', onclick: () => { targetSel = tSel.value; bindNow(tSel.value, pSel.value, sSel.value); } }))));
  }

  // dragging a link out of a signal box onto a parameter row
  function startDrag(svg, n, e0) {
    const x1 = n.x + n.w, y1 = n.y + n.h / 2, line = sv('path', { class: 'g-wire drag' }); svg.append(line);
    const hit = (e) => { svg.querySelectorAll('.g-hit.over').forEach((x) => x.classList.remove('over')); const t = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.g-hit'); if (t) t.classList.add('over'); return t; };
    const toSvg = (e) => { const m = svg.getScreenCTM()?.inverse(); return m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m) : { x: x1, y: y1 }; };
    const move = (e) => { const p = toSvg(e); line.setAttribute('d', `M${x1} ${y1} L${p.x} ${p.y}`); hit(e); };
    const up = (e) => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); const t = hit(e); svg.querySelectorAll('.g-hit.over').forEach((x) => x.classList.remove('over')); line.remove(); if (t && e.type === 'pointerup') bindNow(t.dataset.node, t.dataset.key, n.source); };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up); move(e0);
  }

  function draw() {
    raf = 0;
    if (!root.classList.contains('on')) return;
    const { clip, base } = clips();
    const canEdit = editable();
    const g = buildGraph(clip, base, { allSignals: canEdit });
    caption.textContent = `${clip ? `${clip.name || 'Clip'}: ` : ''}${describeGraph(g)}${store.ghost && clip ? ' (showing the PREVIEW)' : ''}`;
    holder.replaceChildren(); vals = new Map(); wiresEl = new Map(); sigs = new Map(); lastGraph = g.empty ? null : g;
    renderTools(clip, canEdit);
    if (g.empty) { note.textContent = ''; return; }
    const svg = sv('svg', { class: 'graph-svg', id: 'graph-svg', viewBox: `0 0 ${g.width} ${g.height}`, width: '100%', role: 'img', 'aria-label': describeGraph(g) },
      sv('defs', {}, sv('marker', { id: 'g-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto' }, sv('path', { d: 'M0 0 L8 4 L0 8 z', class: 'g-arrowhead' }))));
    for (const e of g.edges) {
      if (e.kind === 'flow') svg.append(sv('line', { class: `g-flow${e.isNew ? ' new' : ''}`, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 - 1, 'marker-end': 'url(#g-arrow)' }));
      else {
        const mx = (e.x1 + e.x2) / 2;
        const wire = sv('path', { class: `g-wire${e.isNew ? ' new' : ''}${e.amount < 0 ? ' neg' : ''}`, 'data-source': e.source, 'data-key': e.key, d: `M${e.x1} ${e.y1} C${mx} ${e.y1} ${mx} ${e.y2} ${e.x2} ${e.y2}` });
        wiresEl.set(`${e.to}|${e.key}`, wire); svg.append(wire);
        if (canEdit) { const hitw = sv('path', { class: `g-wire-hit${selectedWire && selectedWire.node === e.to && selectedWire.key === e.key ? ' sel' : ''}`, 'data-node': e.to, 'data-key': e.key, 'data-source': e.source, d: `M${e.x1} ${e.y1} C${mx} ${e.y1} ${mx} ${e.y2} ${e.x2} ${e.y2}` }, sv('title', {}, txt('Click to set how strongly, or remove'))); hitw.addEventListener('click', () => { selectedWire = { node: e.to, key: e.key }; later(); }); svg.append(hitw); }
        svg.append(sv('text', { class: 'g-amt', x: mx, y: (e.y1 + e.y2) / 2 - 2, 'text-anchor': 'middle' }, txt(+e.amount.toFixed(2))));
      }
    }
    let fxIndex = 0;
    for (const n of g.nodes) {
      const idx = n.kind === 'effect' ? fxIndex++ : -1;
      const grp = sv('g', { class: `g-node ${n.kind}${n.enabled ? '' : ' off'}${n.isNew ? ' new' : ''}`, 'data-node': n.id, 'data-kind': n.kind, 'data-type': n.type, transform: `translate(${n.x} ${n.y})` });
      grp.append(sv('rect', { class: 'g-box', width: n.w, height: n.h, rx: 2 }));
      grp.append(sv('text', { class: 'g-title', x: 7, y: n.kind === 'signal' ? n.h / 2 + 3.5 : 15 }, txt(n.label)));
      if (n.isNew) grp.append(sv('text', { class: 'g-badge', x: n.w - 6, y: 15, 'text-anchor': 'end' }, txt('new')));
      if (!n.enabled && !(canEdit && n.kind === 'effect')) grp.append(sv('text', { class: 'g-badge', x: n.w - 6, y: 15, 'text-anchor': 'end' }, txt('off')));
      if (n.kind === 'effect' && n.cost === 'heavy' && !canEdit) grp.append(sv('text', { class: 'g-cost', x: n.w - 6 - (n.isNew || !n.enabled ? 30 : 0), y: 15, 'text-anchor': 'end' }, sv('title', {}, txt('A demanding effect (the editor\'s own estimate). Several of these can make playback stutter on older computers.')), txt('heavy')));
      if (n.kind === 'signal' && canEdit) { grp.classList.add('drag-from'); if (n.unused) grp.classList.add('idle'); grp.style.cursor = 'crosshair'; grp.append(sv('title', {}, txt(`Drag from here onto a parameter to make it follow the ${n.label}`))); grp.addEventListener('pointerdown', (e) => { e.preventDefault(); startDrag(svg, n, e); }); }
      if (n.kind === 'signal') { const lv = sv('rect', { class: 'g-level', x: 1, y: n.h - 4, width: 0, height: 3 }); sigs.set(n.source, lv); grp.append(lv); }
      n.ports.forEach((p, i) => {
        const py = GEOM.head + i * GEOM.row + GEOM.row / 2;
        if (canEdit && p.range) grp.append(sv('rect', { class: 'g-hit', 'data-node': n.id, 'data-key': p.key, x: 0, y: py - GEOM.row / 2, width: n.w, height: GEOM.row }));
        if (p.bound) grp.append(sv('circle', { class: `g-dot${p.isNewBind ? ' new' : ''}`, cx: 0, cy: py, r: 3 }));
        grp.append(sv('text', { class: 'g-port', x: 9, y: py + 3.5 }, txt(`${p.animated ? '∿ ' : ''}${p.label}`)));
        const val = sv('text', { class: 'g-val', x: n.w - 7, y: py + 3.5, 'text-anchor': 'end' }, txt(p.value));
        vals.set(`${n.id}|${p.key}`, val); grp.append(val);
      });
      if (n.kind === 'effect' && canEdit) {
        const btn = (x, label, kind, title) => { const b = sv('g', { class: 'g-btn', 'data-act': kind, 'data-node': n.id, transform: `translate(${x} 3)` }, sv('rect', { width: 14, height: 14, rx: 2 }), sv('text', { x: 7, y: 11, 'text-anchor': 'middle' }, txt(label)), sv('title', {}, txt(title))); b.addEventListener('click', (e) => { e.stopPropagation(); act(kind, n.id, idx); }); return b; };
        const total = g.nodes.filter((x) => x.kind === 'effect').length;
        if (idx > 0) grp.append(btn(n.w - 60, '↑', 'up', 'Run earlier')); if (idx < total - 1) grp.append(btn(n.w - 45, '↓', 'down', 'Run later'));
        grp.append(btn(n.w - 30, n.enabled ? '●' : '○', 'toggle', n.enabled ? 'Switch off' : 'Switch on'), btn(n.w - 15, '✕', 'remove', 'Remove this effect'));
      } else if (n.kind === 'effect') {
        grp.style.cursor = 'pointer';
        grp.append(sv('title', {}, txt(`${n.label}: click to open it in the Inspector`)));
        grp.addEventListener('click', () => { document.querySelector('[data-tabs="right"] [data-tab="inspector"]')?.click(); setTimeout(() => document.querySelectorAll('#inspector .fx-card')[idx]?.scrollIntoView({ block: 'nearest' }), 30); });
      }
      svg.append(grp);
    }
    holder.append(svg);
    live();
  }

  // while playing or scrubbing: the numbers, the lines and the signal levels follow the sound (same maths as the renderer)
  function live() {
    liveRaf = 0;
    if (!lastGraph || !root.classList.contains('on')) return;
    const { clip } = clips(); if (!clip) return;
    const reactiveOn = store.project.reactive?.enabled !== false;
    const feats = reactiveOn ? sampleFeatures(store.analysis, store.playhead) : null;
    const L = liveGraph(clip, store.playhead, feats, lastGraph);
    for (const [k, v] of Object.entries(L.ports)) { const t = vals.get(k); if (t && t.textContent !== v) t.textContent = v; }
    for (const [k, w] of wiresEl) { const lv = L.wires[k]?.level ?? 0; w.style.strokeWidth = String(+(1.2 + 2.6 * lv).toFixed(2)); w.style.opacity = String(+(0.4 + 0.6 * lv).toFixed(2)); }
    for (const [src, r] of sigs) r.setAttribute('width', String(+((GEOM.sigW - 2) * (L.signals[src] ?? 0)).toFixed(1)));
    note.textContent = !lastGraph.hasWires ? '' : !reactiveOn ? 'Audio-reactive links are switched off in this project (Audio-Reactive tab), so the lines stay still.' : !store.analysis ? 'Analyze the audio (Audio-Reactive tab) to see the lines move with the sound.' : store.analysisStale ? 'The audio changed since it was analyzed: analyze again for the lines to match.' : '';
  }
  // run `fn` on the next animation frame, or after 100 ms if frames are being held back (a busy or hidden window), whichever comes first; never twice
  const defer = (fn) => { let done = false; const go = () => { if (done) return; done = true; clearTimeout(t); cancelAnimationFrame(r); fn(); }; const r = requestAnimationFrame(go); const t = setTimeout(go, 100); };
  let raf = 0, liveRaf = 0;
  const laterLive = () => { if (!liveRaf) { liveRaf = 1; defer(live); } };
  store.on('playhead', laterLive); store.on('analysis', laterLive);
  const later = () => { if (!raf) { raf = 1; defer(draw); } };
  edit.addEventListener('change', () => { selectedWire = null; later(); });
  for (const t of ['selection', 'project', 'ghost', 'keyframes', 'reset']) store.on(t, later);
  document.querySelector('[data-tabs="right"]')?.addEventListener('click', () => setTimeout(later, 0));
  later();
  return { redraw: draw };
}
