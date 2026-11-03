// Live values for the Graph (pure): what each wired or animated parameter is RIGHT NOW, and how loud each signal is, computed with the same
// resolveParam the renderer uses, so the picture matches what is on screen. It reads the clip and changes nothing.
import { resolveParam, REACTIVE_SOURCES } from '../params.js';
import { buildGraph, fmtValue } from './layout.js';

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/**
 * @param clip   the clip the graph was built from
 * @param t      project time (seconds): the playhead
 * @param feats  {rms,bass,mid,high,beat} at t, or null when there is no analysis / bindings are off
 * @returns {{reactive:boolean, signals:Object<string,number>, ports:Object<string,string>, wires:Object<string,{source:string,level:number,push:number}>}}
 *   ports/wires are keyed `${nodeId}|${paramKey}`
 */
export function liveGraph(clip, t, feats, graph = buildGraph(clip)) {
  const out = { reactive: !!feats, signals: {}, ports: {}, wires: {} };
  feats = feats ? Object.fromEntries(REACTIVE_SOURCES.map((s) => [s, clamp01(feats[s])])) : null; // a damaged signal shows as silence, never as NaN on screen
  if (!clip || graph.empty) return out;
  const lt = Math.min(Math.max(0, t - clip.start), clip.duration);
  for (const s of REACTIVE_SOURCES) out.signals[s] = feats ? clamp01(feats[s]) : 0;
  for (const n of graph.nodes) {
    if (n.kind !== 'clip' && n.kind !== 'effect') continue;
    const owner = n.kind === 'clip' ? clip : (clip.effects || []).find((e) => e.id === n.id);
    if (!owner) continue;
    for (const p of n.ports) {
      if (!p.range || p.base === null) continue;
      const v = resolveParam(owner, p.key, p.base, lt, feats, p.range);
      out.ports[`${n.id}|${p.key}`] = fmtValue(v);
      if (p.bound && feats && REACTIVE_SOURCES.includes(p.source)) {
        const level = clamp01(feats[p.source]);
        out.wires[`${n.id}|${p.key}`] = { source: p.source, level, push: p.amount * level };
      }
    }
  }
  return out;
}
