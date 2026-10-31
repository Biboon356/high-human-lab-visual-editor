// Project DNA: the identity of a whole project, as an ordinary Mutate DNA (shared/mutation/dna.js) of kind 'project'.
//   chain     a signature look made by the same generate() the Mutate tab uses, leaning the way the identity leans
//   recipe    how that chain was made, so reproduceDna() rebuilds it
//   identity  traits, palette, style biases and suggestions for Memory, Trace and the organic layer (identity.js)
// Deterministic: the same inputs (rounded, so float noise does not matter) and the same seed give the same DNA, always.
// It never edits a project. Tools may *offer* its suggestions; the user decides.
import { createDna, stableStringify } from '../mutation/dna.js';
import { generate, ENGINE_VERSION, hslToHex, hexToHsl } from '../mutation/mutate.js';
import { rng, toSeed, childSeed, pick } from '../mutation/rng.js';
import { normalizeHex } from '../mutation/chain.js';
import { cleanIdentity } from './identity.js';

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const r2 = (v) => Math.round(v * 100) / 100;

/** Inputs made safe and rounded, so the fingerprint is stable. */
export function normalizeInputs(raw = {}) {
  const e = raw.energy || {};
  const palette = (raw.palette || []).map(normalizeHex).filter(Boolean).slice(0, 6);
  const biases = {};
  for (const [k, w] of Object.entries(raw.styleBias || {})) if (Number.isFinite(w) && w > 0) biases[k] = r2(Math.min(6, w));
  return {
    bpm: Number.isFinite(raw.bpm) && raw.bpm > 0 ? Math.round(raw.bpm) : null,
    energy: { rms: r2(clamp01(e.rms)), bass: r2(clamp01(e.bass)), mid: r2(clamp01(e.mid)), high: r2(clamp01(e.high)) },
    density: r2(clamp01(raw.density)), motion: r2(clamp01(raw.motion)),
    palette, duration: Math.round(Math.max(0, raw.duration || 0)),
    styleBias: biases,
    mutateSeeds: (raw.mutateSeeds || []).filter(Number.isFinite).slice(0, 8).map((s) => Math.floor(s) >>> 0),
  };
}

/** 0 = cool, 1 = warm, from hues (reds, oranges, magentas are warm; cyans and blues are cool). */
function warmthOf(palette) {
  if (!palette.length) return 0.5;
  const w = palette.map((hex) => { const [h, s] = hexToHsl(hex); const d = Math.min(Math.abs(h - 25), 360 - Math.abs(h - 25)); return { v: 1 - Math.min(1, d / 180), s }; });
  const ws = w.reduce((a, x) => a + x.s + 0.05, 0);
  return clamp01(w.reduce((a, x) => a + x.v * (x.s + 0.05), 0) / ws);
}

const WORDS = {
  pace: [['Slow', 'Still', 'Hushed'], ['Walking', 'Steady', 'Turning'], ['Restless', 'Feverish', 'Rushing']],
  noun: { warm: ['ember', 'clay', 'marigold', 'rust', 'saffron'], cool: ['tide', 'frost', 'glass', 'moss', 'slate'], gritty: ['static', 'soot', 'tape', 'xerox', 'gravel'] },
};

export function deriveProjectDna(rawInputs, { seed = 1, now = 0, name } = {}) {
  const n = normalizeInputs(rawInputs);
  const fingerprint = toSeed(stableStringify({ n, seed })).toString(36);
  const r = rng(toSeed(fingerprint));
  const tempo = n.bpm ? clamp01((n.bpm - 70) / 110) : 0.4;
  const loud = clamp01(0.45 * n.energy.rms + 0.35 * n.energy.bass + 0.2 * n.energy.high);
  const energy = r2(clamp01(0.7 * loud + 0.3 * tempo));
  const warmth = r2(warmthOf(n.palette));
  const grit = r2(clamp01(0.5 * n.energy.high + 0.3 * n.density + 0.2 * n.motion));
  const calm = r2(clamp01(1 - (0.5 * energy + 0.3 * n.motion + 0.2 * n.density)));

  // a palette of at least three colours: what the footage gave, then colours that sit well with it
  const palette = [...n.palette];
  const [h0] = palette.length ? hexToHsl(palette[0]) : [r() * 360];
  for (const [dh, s, l] of [[30, 0.55, 0.5], [180, 0.5, 0.42], [-35, 0.6, 0.55]]) { if (palette.length >= 3) break; palette.push(hslToHex((h0 + dh + 360) % 360, s + r() * 0.15, l + r() * 0.08)); }

  // which kinds of effect this project leans toward (merged with any bias the user already chose)
  const lean = { analog: 1 + warmth * 1.5 + grit * 1.5, print: grit * 3, camera: 1 + (1 - warmth) * 2 + calm, distort: energy * 3.2 + n.motion * 1.5, organic: 0.5 + calm * 2.5, colour: 1, pattern: warmth * 0.8 };
  const biases = {};
  for (const [k, v] of Object.entries(lean)) biases[k] = r2(Math.min(6, v + (n.styleBias[k] || 0)));
  for (const [k, v] of Object.entries(n.styleBias)) if (!(k in biases)) biases[k] = v;

  const memMode = n.density > 0.6 && (n.bpm || 0) > 110 ? 3 : n.motion > 0.5 ? 2 : warmth > 0.55 ? 1 : 0;
  const identity = {
    version: 1,
    name: name || `${pick(r, WORDS.pace[energy < 0.34 ? 0 : energy < 0.67 ? 1 : 2])} ${pick(r, WORDS.noun[grit > 0.55 ? 'gritty' : warmth > 0.5 ? 'warm' : 'cool'])}`,
    traits: { energy, warmth, grit, motion: n.motion, density: n.density, calm },
    palette, biases,
    organic: { growSeconds: r2(7 - 5 * energy), thickness: r2(0.12 + 0.2 * (1 - grit)), density: r2(0.8 + 2.2 * n.motion + energy), glow: r2(0.5 + 0.5 * energy), spores: r2(clamp01(n.energy.high * 1.2)) },
    memory: { mode: memMode, length: r2(0.8 + calm * 2.2), decay: r2(0.3 + 0.5 * grit), intensity: r2(0.6 + 0.4 * energy), blend: 1 },
    trace: { smoothing: r2(0.15 + calm * 0.5), mode: calm > 0.5 ? 'grow' : 'residue' },
    inputs: { bpm: n.bpm, duration: n.duration, density: n.density, motion: n.motion, energy: n.energy },
  };

  // the signature look: the Mutate generator, biased by the identity, from a seed that follows from the fingerprint
  const options = { seed: childSeed(toSeed(fingerprint), 'signature'), length: 3, strength: 0.5, bias: Object.fromEntries(Object.entries(biases).map(([k, v]) => [k, v])), maxHeavy: 0 };
  const out = generate(options);
  const { dna } = createDna({ id: `project:${fingerprint}`, name: identity.name, chain: out.chain, seed, tags: ['project'], note: `Project identity (${fingerprint})`, source: { kind: 'project', fingerprint }, recipe: { mode: 'generate', base: null, options, engine: ENGINE_VERSION }, identity: cleanIdentity(identity), now });
  return dna;
}

/** Plain-language lines a tool can show next to an offer to use the suggestion. */
export function describeIdentity(id) {
  const t = id.traits, pct = (v) => `${Math.round(v * 100)}%`;
  const modes = ['Ghost', 'Stain', 'Scar', 'Echo'];
  return [
    `${t.energy > 0.66 ? 'High' : t.energy > 0.33 ? 'Medium' : 'Low'} energy, ${t.warmth > 0.55 ? 'warm' : t.warmth < 0.45 ? 'cool' : 'neutral'} colour, ${t.grit > 0.55 ? 'gritty' : 'clean'} (${pct(t.density)} cutting, ${pct(t.motion)} motion).`,
    `Memory: ${modes[id.memory.mode]}, ${id.memory.length} s.`,
    `Organic growth over about ${id.organic.growSeconds} s, thickness ${id.organic.thickness}.`,
    `Trace smoothing ${pct(id.trace.smoothing)}, ${id.trace.mode === 'grow' ? 'roots' : 'residue'}.`,
  ];
}
