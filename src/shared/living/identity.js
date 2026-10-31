// The identity layer of a Project DNA: a handful of bounded numbers and colours that describe how a project *feels*. It rides inside an
// ordinary DNA (shared/mutation/dna.js, field `identity`), so it saves, loads, exports and compares with everything else.
// Everything here is advice for the tools (Mutate, Memory, Trace, organic layer); nothing in it edits the project.
import { normalizeHex } from '../mutation/chain.js';
import { CATEGORIES } from '../mutation/effect-meta.js';

export const IDENTITY_VERSION = 1;
const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const round = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;
export const TRAITS = ['energy', 'warmth', 'grit', 'motion', 'density', 'calm'];

/** Repairs an identity read from a file or a project. Returns null when it is not one. */
export function cleanIdentity(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.version === 'number' && raw.version > IDENTITY_VERSION) return null;
  const traits = {};
  for (const k of TRAITS) traits[k] = round(clamp(raw.traits?.[k], 0, 1, 0.5));
  const palette = (Array.isArray(raw.palette) ? raw.palette : []).map(normalizeHex).filter(Boolean).slice(0, 6);
  const biases = {};
  for (const [k, w] of Object.entries(raw.biases || {})) if (CATEGORIES.includes(k) && Number.isFinite(w)) biases[k] = round(clamp(w, 0, 6, 0), 2);
  const o = raw.organic || {}, m = raw.memory || {}, t = raw.trace || {}, i = raw.inputs || {};
  return {
    version: IDENTITY_VERSION,
    name: String(raw.name || 'Untitled identity').trim().slice(0, 60),
    traits, palette, biases,
    organic: { growSeconds: round(clamp(o.growSeconds, 1, 20, 5), 1), thickness: round(clamp(o.thickness, 0.02, 0.6, 0.16)), density: round(clamp(o.density, 0.5, 8, 2.4), 2), glow: round(clamp(o.glow, 0, 2, 0.9), 2), spores: round(clamp(o.spores, 0, 1, 0.3), 2) },
    memory: { mode: Math.round(clamp(m.mode, 0, 3, 0)), length: round(clamp(m.length, 0.1, 6, 1.2), 2), decay: round(clamp(m.decay, 0, 1, 0.5), 2), intensity: round(clamp(m.intensity, 0, 1.5, 0.8), 2), blend: Math.round(clamp(m.blend, 0, 3, 1)) },
    trace: { smoothing: round(clamp(t.smoothing, 0, 1, 0.25), 2), mode: t.mode === 'residue' ? 'residue' : 'grow' },
    inputs: { bpm: i.bpm === null || i.bpm === undefined ? null : Math.round(clamp(i.bpm, 30, 300, 120)), duration: round(clamp(i.duration, 0, 36000, 0), 1), density: round(clamp(i.density, 0, 1, 0)), motion: round(clamp(i.motion, 0, 1, 0)),
      energy: Object.fromEntries(['rms', 'bass', 'mid', 'high'].map((k) => [k, round(clamp(i.energy?.[k], 0, 1, 0))])) },
  };
}
