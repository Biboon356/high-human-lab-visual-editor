// The living layer: the existing organic effects (veins, spores) plus Memory Bleed, set up from a Project DNA and the music.
// No new renderer and no new engine — this only decides parameters, bindings and keyframes for effects that already exist:
//   veins   grow in from the edges. Their growth is keyframed from the music's energy, so loud bars grow them faster than quiet ones.
//           Glow follows the bass, flow follows the beat. Colour, thickness and density come from the identity.
//   spores  drift with the high end of the music (only when the identity asks for them)
//   memory  a Stain after them: the veins leave a slowly fading colour behind (the vein "remembers")
import { createClip, defaultProps } from '../project.js';
import { createEffect, EFFECTS } from '../effects-defs.js';
import { fixParam } from '../mutation/chain.js';
import { toSeed } from '../mutation/rng.js';

/**
 * Growth keyframes whose slope follows the energy: each bar advances the growth by its length times (0.25 + its energy), so the whole
 * piece goes 0 → 1. @param bars [{start, end, energy 0..1}] (shared/music-structure.js) @returns [{t, v}] or null without usable bars
 */
export function growthKeysFromEnergy(bars, duration, maxKeys = 48) {
  const usable = (bars || []).filter((b) => b.end > b.start && b.start < duration);
  if (!usable.length || !(duration > 0)) return null;
  const clipped = usable.map((b) => ({ start: Math.max(0, b.start), end: Math.min(duration, b.end), energy: Math.min(1, Math.max(0, b.energy ?? 0.5)) })).filter((b) => b.end > b.start);
  const weights = clipped.map((b) => (b.end - b.start) * (0.25 + b.energy));
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  const keys = [{ t: 0, v: 0 }];
  let acc = 0;
  clipped.forEach((b, i) => { acc += weights[i]; keys.push({ t: Math.round(b.end * 1000) / 1000, v: Math.round((acc / total) * 1e4) / 1e4 }); });
  keys[keys.length - 1].v = 1;
  // too many bars: keep an even spread of them (the curve is smooth between keys anyway)
  if (keys.length > maxKeys) { const step = (keys.length - 1) / (maxKeys - 1); return Array.from({ length: maxKeys }, (_, i) => keys[Math.min(keys.length - 1, Math.round(i * step))]); }
  return keys;
}

/** An effect with its numbers snapped to the sliders' own steps, so what an identity suggests is exactly what the Inspector will show. */
function effect(type, params) {
  const e = createEffect(type, params);
  for (const d of EFFECTS[type].params) e.params[d.key] = fixParam(d, e.params[d.key]).value;
  return e;
}

/**
 * An adjustment layer carrying the living look. @param identity (living/identity.js) @param o {start, duration, bars, seed}
 */
export function createLivingLayerClip(identity, { start = 0, duration = 10, bars = null, seed = 7, trackId = null } = {}) {
  const o = identity.organic, pal = identity.palette, m = identity.memory;
  const veins = effect('veins', { mode: 0, origin: 5, density: o.density, thickness: o.thickness, glow: o.glow, cling: 0.6, warp: 0.9, seed: toSeed(`${seed}/veins`) % 100, color: pal[0] || '#7dffb0', mix: 1 });
  veins.keyframes.growth = growthKeysFromEnergy(bars, duration) || [{ t: 0, v: 0 }, { t: Math.min(duration, o.growSeconds), v: 1 }];
  veins.bindings.glow = { source: 'bass', amount: 0.35 };
  veins.bindings.flow = { source: 'beat', amount: 0.4 };
  const effects = [veins];
  if (o.spores > 0.35) {
    const spores = effect('spores', { density: 0.6 + o.spores, glow: o.glow + 0.3, speed: 0.3, color: pal[1] || pal[0] || '#c8ffd8' });
    spores.bindings.speed = { source: 'high', amount: 0.3 };
    effects.push(spores);
  }
  // the vein remembers: a Stain, in the identity's own memory settings, kept soft
  effects.push(effect('memory', { mode: 1, length: m.length, decay: m.decay, intensity: Math.min(1, m.intensity), blend: 1, spread: 0.4 }));
  return createClip({ type: 'adjust', name: `Living layer · ${identity.name}`, trackId, start, duration, props: defaultProps(), effects });
}

/** Generator parameters for a Grow trace in the voice of the identity (thickness, density, glow); the clip keeps its own seed. */
export function traceVoice(identity) {
  if (!identity) return {};
  return { thickness: identity.organic.thickness, density: identity.organic.density, glow: Math.min(1, identity.organic.glow), distortion: Math.round((0.35 + (1 - identity.traits.calm) * 0.45) * 100) / 100 };
}
