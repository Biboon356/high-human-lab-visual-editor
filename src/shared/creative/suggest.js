// What COULD be worth saying, from the present context. This only proposes candidates: it never shows anything. Every candidate carries a
// confidence, the contexts it belongs to, and ONE short sentence explaining why; the Decision Gate (gate.js) decides whether it is
// actually surfaced, and nearly always the answer is no.
import { EFFECTS } from '../effects-defs.js';
import { chainDistance, motionOf } from './observe.js';
import { orderPair, planRelation, chainOfClip, motionKeys } from './relate.js';
import { hexToHsl } from '../mutation/mutate.js';

const HEADINGS = { follow: 'LET IT FLOW', grow: 'LET IT GROW', remember: 'LET IT REMEMBER', become: 'LET IT BECOME' };
const typesOf = (chain) => new Set(chain.map((c) => c.type));
const jaccard = (a, b) => { const u = new Set([...a, ...b]); if (!u.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / u.size; };

/** 0..1: how close the colours of a memory are to the project's palette (a gentle preference, never a requirement). */
export function paletteAffinity(memory, palette) {
  if (!palette?.length) return 0;
  const colors = [];
  for (const it of memory.data?.chain || []) for (const p of EFFECTS[it.type]?.params || []) if (p.kind === 'color' && typeof it.params?.[p.key] === 'string') colors.push(it.params[p.key]);
  for (const c of memory.data?.colors || []) colors.push(c);
  if (!colors.length) return 0;
  let best = 180;
  for (const c of colors) for (const q of palette) { const d = Math.abs(hexToHsl(c)[0] - hexToHsl(q)[0]); best = Math.min(best, Math.min(d, 360 - d)); }
  return 1 - best / 180;
}

function relateCandidates(project, context) {
  const pair = orderPair(project, context.clipIds[0], context.clipIds[1]);
  if (!pair) return [];
  const { from: A, to: B } = pair;
  const has = (c, type) => c.effects.some((e) => e.type === type && e.enabled !== false);
  const picks = [];
  const aMoves = motionKeys(A).filter((k) => !(B.keyframes?.[k] || []).length);
  if (aMoves.length) picks.push(['follow', 0.72, 'The first shot moves and this one stays still.']);
  if (has(A, 'veins') && !has(B, 'veins')) picks.push(['grow', 0.78, 'Growth on the first shot stops at the cut.']);
  if (has(A, 'memory') && !has(B, 'memory')) picks.push(['remember', 0.7, 'The first shot remembers, but the memory ends at the cut.']);
  const ca = chainOfClip(A), cb = chainOfClip(B);
  if (ca.length && cb.length && chainDistance(ca, cb) >= 0.6) picks.push(['become', 0.68, 'These two shots look very different.']);
  return picks
    .filter(([rel]) => !planRelation(project, rel, A.id, B.id).reason) // only what can actually be applied
    .map(([rel, confidence, line]) => ({ key: `relate:${rel}:${A.id}:${B.id}`, kind: 'relate', relation: rel, contexts: ['connecting-scenes'], clipIds: [A.id, B.id], heading: HEADINGS[rel], line, confidence }));
}

function lookBackCandidates(project, context, shelf, identity) {
  const clip = project.clips.find((c) => c.id === context.clipIds[0]);
  if (!clip || !shelf.length) return [];
  const items = [];
  if (context.kind === 'searching-look') {
    const chain = chainOfClip(clip), types = typesOf(chain);
    if (!chain.length) return [];
    for (const m of shelf) {
      if (m.kind !== 'looked') continue;
      const j = jaccard(types, typesOf(m.data.chain)), d = chainDistance(chain, m.data.chain);
      if (j >= 0.6 && d >= 0.15 && d <= 0.7) items.push({ m, rank: j + 0.3 * paletteAffinity(m, identity?.palette) });
    }
  } else if (context.kind === 'experimenting-motion') {
    const mine = Object.keys(motionOf(clip)).sort().join();
    if (!mine) return [];
    for (const m of shelf) if (m.kind === 'moved' && Object.keys(m.data.tracks).sort().join() === mine) items.push({ m, rank: 1 });
  }
  items.sort((a, b) => b.rank - a.rank || b.m.at - a.m.at);
  const top = items.slice(0, 3);
  if (!top.length) return [];
  return [{ key: `lookback:${clip.id}:${context.kind}`, kind: 'lookback', contexts: [context.kind], clipIds: [clip.id], heading: 'LOOK BACK', line: 'You made something like this before.',
    items: top.map(({ m }) => ({ id: m.id, kind: m.kind, name: m.name })), confidence: 0.7 + Math.min(0.2, 0.2 * (top[0].rank - 0.6)) }];
}

/** Candidates for the current context, most confident first. Nothing is shown from here. */
export function suggestFor({ project, context, shelf = [], identity = null } = {}) {
  if (!project || !context || context.kind === 'idle') return [];
  let out = [];
  if (context.kind === 'connecting-scenes' && context.clipIds.length === 2) out = relateCandidates(project, context);
  else if (context.kind === 'searching-look' || context.kind === 'experimenting-motion') out = lookBackCandidates(project, context, shelf, identity);
  return out.sort((a, b) => b.confidence - a.confidence);
}
