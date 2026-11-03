// Graph tab: the selected clip's effect chain drawn as boxes and wires, with the audio links as wires from loudness / bass / mids / highs / beats
// to the exact parameter they move. It only DRAWS what is already in the project (read-only); while a PREVIEW is showing it draws the preview and
// marks what is new, so a plan can be understood as a picture before it is applied. Clicking an effect jumps to its card in the Inspector.
import { store } from '../store.js';
import { el } from './dom.js';
import { buildGraph, describeGraph, GEOM } from '/shared/graph/layout.js';
import { liveGraph } from '/shared/graph/live.js';
import { sampleFeatures } from '/shared/audio-analysis.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : String(v)); for (const k of kids) if (k != null) n.append(k); return n; };
const txt = (s) => document.createTextNode(String(s));

export function mountGraph(root) {
  const caption = el('p', { class: 'hint pad', id: 'graph-caption' });
  const note = el('p', { class: 'hint pad graph-note', id: 'graph-live-note' });
  const holder = el('div', { class: 'graph-holder', id: 'graph-holder' });
  const legend = el('p', { class: 'hint pad graph-legend', text: 'Boxes are the effects in the order they run, top to bottom. A line from the left is a parameter following the music (the number is how strongly; a minus means opposite). ● follows music · ∿ animated by keyframes · new = only in the preview · heavy = a demanding effect (the editor\'s own estimate, not measured on your computer). While you play, the lines and numbers move with the sound.' });
  root.append(el('header', { class: 'pane-head' }, el('h2', { text: 'Graph' }), el('span', { text: 'See the chain and what follows the music' })), caption, note, holder, legend);

  function clips() {
    const id = store.selection; if (!id) return { clip: null, base: null };
    const real = store.project.clips.find((c) => c.id === id) || null;
    if (store.ghost) { const g = store.ghost.clips.find((c) => c.id === id); if (g) return { clip: g, base: real }; }
    return { clip: real, base: null };
  }

  let lastGraph = null, vals = new Map(), wiresEl = new Map(), sigs = new Map();
  function draw() {
    raf = 0;
    if (!root.classList.contains('on')) return;
    const { clip, base } = clips();
    const g = buildGraph(clip, base);
    caption.textContent = `${clip ? `${clip.name || 'Clip'}: ` : ''}${describeGraph(g)}${store.ghost && clip ? ' (showing the PREVIEW)' : ''}`;
    holder.replaceChildren(); vals = new Map(); wiresEl = new Map(); sigs = new Map(); lastGraph = g.empty ? null : g;
    if (g.empty) { note.textContent = ''; return; }
    const svg = sv('svg', { class: 'graph-svg', id: 'graph-svg', viewBox: `0 0 ${g.width} ${g.height}`, width: '100%', role: 'img', 'aria-label': describeGraph(g) },
      sv('defs', {}, sv('marker', { id: 'g-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto' }, sv('path', { d: 'M0 0 L8 4 L0 8 z', class: 'g-arrowhead' }))));
    for (const e of g.edges) {
      if (e.kind === 'flow') svg.append(sv('line', { class: `g-flow${e.isNew ? ' new' : ''}`, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 - 1, 'marker-end': 'url(#g-arrow)' }));
      else {
        const mx = (e.x1 + e.x2) / 2;
        const wire = sv('path', { class: `g-wire${e.isNew ? ' new' : ''}${e.amount < 0 ? ' neg' : ''}`, 'data-source': e.source, 'data-key': e.key, d: `M${e.x1} ${e.y1} C${mx} ${e.y1} ${mx} ${e.y2} ${e.x2} ${e.y2}` });
        wiresEl.set(`${e.to}|${e.key}`, wire); svg.append(wire);
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
      if (!n.enabled) grp.append(sv('text', { class: 'g-badge', x: n.w - 6, y: 15, 'text-anchor': 'end' }, txt('off')));
      if (n.kind === 'effect' && n.cost === 'heavy') grp.append(sv('text', { class: 'g-cost', x: n.w - 6 - (n.isNew || !n.enabled ? 30 : 0), y: 15, 'text-anchor': 'end' }, sv('title', {}, txt('A demanding effect (the editor\'s own estimate). Several of these can make playback stutter on older computers.')), txt('heavy')));
      if (n.kind === 'signal') { const lv = sv('rect', { class: 'g-level', x: 1, y: n.h - 4, width: 0, height: 3 }); sigs.set(n.source, lv); grp.append(lv); }
      n.ports.forEach((p, i) => {
        const py = GEOM.head + i * GEOM.row + GEOM.row / 2;
        if (p.bound) grp.append(sv('circle', { class: `g-dot${p.isNewBind ? ' new' : ''}`, cx: 0, cy: py, r: 3 }));
        grp.append(sv('text', { class: 'g-port', x: 9, y: py + 3.5 }, txt(`${p.animated ? '∿ ' : ''}${p.label}`)));
        const val = sv('text', { class: 'g-val', x: n.w - 7, y: py + 3.5, 'text-anchor': 'end' }, txt(p.value));
        vals.set(`${n.id}|${p.key}`, val); grp.append(val);
      });
      if (n.kind === 'effect') {
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
  for (const t of ['selection', 'project', 'ghost', 'keyframes', 'reset']) store.on(t, later);
  document.querySelector('[data-tabs="right"]')?.addEventListener('click', () => setTimeout(later, 0));
  later();
  return { redraw: draw };
}
