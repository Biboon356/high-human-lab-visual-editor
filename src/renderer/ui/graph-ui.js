// Graph tab: the selected clip's effect chain drawn as boxes and wires, with the audio links as wires from loudness / bass / mids / highs / beats
// to the exact parameter they move. It only DRAWS what is already in the project (read-only); while a PREVIEW is showing it draws the preview and
// marks what is new, so a plan can be understood as a picture before it is applied. Clicking an effect jumps to its card in the Inspector.
import { store } from '../store.js';
import { el } from './dom.js';
import { buildGraph, describeGraph, GEOM } from '/shared/graph/layout.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : String(v)); for (const k of kids) if (k != null) n.append(k); return n; };
const txt = (s) => document.createTextNode(String(s));

export function mountGraph(root) {
  const caption = el('p', { class: 'hint pad', id: 'graph-caption' });
  const holder = el('div', { class: 'graph-holder', id: 'graph-holder' });
  const legend = el('p', { class: 'hint pad graph-legend', text: 'Boxes are the effects in the order they run, top to bottom. A line from the left is a parameter following the music (the number is how strongly; a minus means opposite). ● follows music · ∿ animated by keyframes · new = only in the preview.' });
  root.append(el('header', { class: 'pane-head' }, el('h2', { text: 'Graph' }), el('span', { text: 'See the chain and what follows the music' })), caption, holder, legend);

  function clips() {
    const id = store.selection; if (!id) return { clip: null, base: null };
    const real = store.project.clips.find((c) => c.id === id) || null;
    if (store.ghost) { const g = store.ghost.clips.find((c) => c.id === id); if (g) return { clip: g, base: real }; }
    return { clip: real, base: null };
  }

  function draw() {
    raf = 0;
    if (!root.classList.contains('on')) return;
    const { clip, base } = clips();
    const g = buildGraph(clip, base);
    caption.textContent = `${clip ? `${clip.name || 'Clip'}: ` : ''}${describeGraph(g)}${store.ghost && clip ? ' (showing the PREVIEW)' : ''}`;
    holder.replaceChildren();
    if (g.empty) return;
    const svg = sv('svg', { class: 'graph-svg', id: 'graph-svg', viewBox: `0 0 ${g.width} ${g.height}`, width: '100%', role: 'img', 'aria-label': describeGraph(g) },
      sv('defs', {}, sv('marker', { id: 'g-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto' }, sv('path', { d: 'M0 0 L8 4 L0 8 z', class: 'g-arrowhead' }))));
    for (const e of g.edges) {
      if (e.kind === 'flow') svg.append(sv('line', { class: `g-flow${e.isNew ? ' new' : ''}`, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 - 1, 'marker-end': 'url(#g-arrow)' }));
      else {
        const mx = (e.x1 + e.x2) / 2;
        svg.append(sv('path', { class: `g-wire${e.isNew ? ' new' : ''}${e.amount < 0 ? ' neg' : ''}`, 'data-source': e.source, 'data-key': e.key, d: `M${e.x1} ${e.y1} C${mx} ${e.y1} ${mx} ${e.y2} ${e.x2} ${e.y2}` }));
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
      n.ports.forEach((p, i) => {
        const py = GEOM.head + i * GEOM.row + GEOM.row / 2;
        if (p.bound) grp.append(sv('circle', { class: `g-dot${p.isNewBind ? ' new' : ''}`, cx: 0, cy: py, r: 3 }));
        grp.append(sv('text', { class: 'g-port', x: 9, y: py + 3.5 }, txt(`${p.animated ? '∿ ' : ''}${p.label}`)));
        grp.append(sv('text', { class: 'g-val', x: n.w - 7, y: py + 3.5, 'text-anchor': 'end' }, txt(p.value)));
      });
      if (n.kind === 'effect') {
        grp.style.cursor = 'pointer';
        grp.append(sv('title', {}, txt(`${n.label}: click to open it in the Inspector`)));
        grp.addEventListener('click', () => { document.querySelector('[data-tabs="right"] [data-tab="inspector"]')?.click(); setTimeout(() => document.querySelectorAll('#inspector .fx-card')[idx]?.scrollIntoView({ block: 'nearest' }), 30); });
      }
      svg.append(grp);
    }
    holder.append(svg);
  }
  let raf = 0;
  const later = () => { if (!raf) raf = requestAnimationFrame(draw); };
  for (const t of ['selection', 'project', 'ghost', 'keyframes', 'reset']) store.on(t, later);
  document.querySelector('[data-tabs="right"]')?.addEventListener('click', () => setTimeout(later, 0));
  later();
  return { redraw: draw };
}
