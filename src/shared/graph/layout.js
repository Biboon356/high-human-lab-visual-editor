// Chain Graph layout (pure): turns one clip into boxes and wires so the editor can DRAW what is already in the project.
// It is a view over the existing data model, not a second one: the flow is the clip's effect chain in its real order, and a wire from a signal
// (loudness, bass, mids, highs, beats) to a parameter is that parameter's audio binding. Nothing here can change the project.
// `base` (optional) is the real clip while `clip` is a PREVIEW copy: effects and wires that only exist in the preview are flagged `isNew`.
import { EFFECTS } from '../effects-defs.js';
import { REACTIVE_SOURCES, CLIP_PROPS } from '../params.js';
import { metaFor } from '../mutation/effect-meta.js';

export const SIGNAL_LABELS = { rms: 'loudness', bass: 'bass', mid: 'mids', high: 'highs', beat: 'beats' };
export const GEOM = { width: 320, sigX: 6, sigW: 70, chainX: 142, chainW: 172, head: 24, row: 16, pad: 6, gap: 22, top: 10, sigH: 24, sigGap: 6 };
export const HEAVY_SUGGESTED = 2; // the same limit the Mutate engine keeps (composeChain maxHeavy)
const PRIMARY = ['amount', 'intensity', 'strength', 'growth', 'density', 'radius', 'size'];

const isNumDef = (d) => !d.kind && !d.toggle && !d.options && Number.isFinite(d.min) && Number.isFinite(d.max);
const shortName = (label) => { const t = String(label).replace(/ \(.*/, '').split(' / ')[0]; return t.length > 18 ? `${t.slice(0, 17)}…` : t; };
export const fmtValue = (v) => (typeof v === 'number' ? String(+v.toFixed(3)) : String(v));
const fmt = fmtValue;

function effectPorts(fx, baseFx) {
  const def = EFFECTS[fx.type];
  const keys = new Set([...Object.keys(fx.bindings || {}), ...Object.keys(fx.keyframes || {})].filter((k) => k === 'wet' || def.params.some((d) => d.key === k)));
  if (!keys.size) { const nd = def.params.filter(isNumDef); const k = PRIMARY.find((p) => nd.some((d) => d.key === p)) || nd[0]?.key; if (k) keys.add(k); }
  return [...keys].map((key) => {
    const d = key === 'wet' ? { label: 'Wet / dry', def: 1 } : def.params.find((x) => x.key === key);
    const value = key === 'wet' ? fx.wet ?? 1 : fx.params?.[key] ?? d.def;
    const b = fx.bindings?.[key] || null;
    const was = baseFx?.bindings?.[key];
    const numeric = key === 'wet' || isNumDef(d);
    return { key, label: String(d.label).replace(/ \(.*/, ''), value: fmt(value), range: numeric ? (key === 'wet' ? [0, 1] : [d.min, d.max]) : null, base: numeric && typeof value === 'number' ? value : null, animated: !!fx.keyframes?.[key]?.length, bound: !!b, source: b?.source || null, amount: b ? b.amount : null, isNewBind: !!b && baseFx !== undefined && !(was && was.source === b.source && was.amount === b.amount) };
  });
}

export function buildGraph(clip, base = null) {
  const G = GEOM;
  if (!clip) return { width: G.width, height: 0, nodes: [], edges: [], empty: true };
  const nodes = [], edges = [];
  let y = G.top;
  const place = (n, rows) => { n.x = G.chainX; n.y = y; n.w = G.chainW; n.h = G.head + rows * G.row + (rows ? G.pad : 4); y += n.h; return n; };
  const portY = (n, i) => n.y + G.head + i * G.row + G.row / 2;

  // clip node: its own bound properties (scale, opacity, ...)
  const clipPorts = Object.entries(clip.bindings || {}).filter(([k]) => CLIP_PROPS.some((d) => d.key === k)).map(([key, b]) => {
    const d = CLIP_PROPS.find((x) => x.key === key);
    return { key, label: d.label, value: fmt(clip.props?.[key] ?? d.def), range: [d.min, d.max], base: clip.props?.[key] ?? d.def, animated: !!clip.keyframes?.[key]?.length, bound: true, source: b.source, amount: b.amount, isNewBind: !!base && !(base.bindings?.[key] && base.bindings[key].source === b.source && base.bindings[key].amount === b.amount) };
  });
  const clipNode = place({ id: 'clip', kind: 'clip', label: String(clip.name || 'Clip').slice(0, 22), enabled: true, isNew: false, ports: clipPorts }, clipPorts.length);
  nodes.push(clipNode);
  let prev = clipNode;

  const baseById = new Map((base?.effects || []).map((e) => [e.id, e]));
  (clip.effects || []).forEach((fx, i) => {
    if (!EFFECTS[fx.type]) return;
    y += G.gap;
    const bfx = base ? baseById.get(fx.id) : undefined;
    const ports = effectPorts(fx, bfx);
    const n = place({ id: fx.id || `fx${i}`, kind: 'effect', type: fx.type, label: shortName(EFFECTS[fx.type].label), cost: metaFor(fx.type)?.cost || 'light', enabled: fx.enabled !== false, isNew: !!base && !bfx, ports }, ports.length);
    nodes.push(n);
    edges.push({ kind: 'flow', from: prev.id, to: n.id, x1: G.chainX + G.chainW / 2, y1: prev.y + prev.h, x2: G.chainX + G.chainW / 2, y2: n.y, isNew: n.isNew });
    prev = n;
  });
  y += G.gap;
  const out = { id: 'out', kind: 'out', label: 'Output', enabled: true, isNew: false, ports: [], x: G.chainX, y, w: G.chainW, h: G.head - 2 };
  nodes.push(out);
  edges.push({ kind: 'flow', from: prev.id, to: 'out', x1: G.chainX + G.chainW / 2, y1: prev.y + prev.h, x2: G.chainX + G.chainW / 2, y2: out.y, isNew: false });

  // signals: only the ones in use, each placed near the average height of what it drives
  const wires = [];
  for (const n of nodes) n.ports.forEach((p, i) => { if (p.bound && REACTIVE_SOURCES.includes(p.source)) wires.push({ node: n, port: p, y: portY(n, i) }); });
  const used = REACTIVE_SOURCES.filter((s) => wires.some((w) => w.port.source === s));
  const sigs = used.map((s) => { const ys = wires.filter((w) => w.port.source === s).map((w) => w.y); return { id: `sig:${s}`, kind: 'signal', source: s, label: SIGNAL_LABELS[s], enabled: true, isNew: false, ports: [], w: G.sigW, h: G.sigH, x: G.sigX, y: ys.reduce((a, b) => a + b, 0) / ys.length - G.sigH / 2 }; });
  sigs.sort((a, b) => a.y - b.y);
  let floor = G.top;
  for (const s of sigs) { s.y = Math.max(s.y, floor); floor = s.y + G.sigH + G.sigGap; }
  nodes.push(...sigs);
  for (const w of wires) {
    const s = sigs.find((x) => x.source === w.port.source);
    edges.push({ kind: 'bind', from: s.id, to: w.node.id, key: w.port.key, x1: s.x + s.w, y1: s.y + G.sigH / 2, x2: G.chainX, y2: w.y, amount: w.port.amount, source: w.port.source, isNew: w.port.isNewBind || w.node.isNew });
  }
  const height = Math.max(out.y + out.h, floor) + G.top;
  const heavy = nodes.filter((n) => n.kind === 'effect' && n.enabled && n.cost === 'heavy').length;
  return { width: G.width, height, nodes, edges, empty: false, hasWires: wires.length > 0, heavy };
}

/** One sentence for the graph's caption / screen readers. */
export function describeGraph(g) {
  if (g.empty) return 'Select a clip to see its effect chain.';
  const fx = g.nodes.filter((n) => n.kind === 'effect'), wires = g.edges.filter((e) => e.kind === 'bind'), fresh = g.nodes.filter((n) => n.isNew).length + wires.filter((e) => e.isNew && !g.nodes.find((n) => n.id === e.to)?.isNew).length;
  const heavy = g.heavy ? ` ${g.heavy} heavy effect${g.heavy === 1 ? '' : 's'}${g.heavy > HEAVY_SUGGESTED ? ': more than the editor suggests, playback may stutter on older computers' : ''}.` : '';
  return `${fx.length} effect${fx.length === 1 ? '' : 's'}, ${wires.length} link${wires.length === 1 ? '' : 's'} to the music${fresh ? `, ${fresh} new in the preview` : ''}.${heavy}`;
}
