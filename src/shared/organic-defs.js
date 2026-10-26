// Organic Visual Engine: procedural generator clip definitions.
import { createClip, defaultProps } from './project.js';
import { createEffect } from './effects-defs.js';

export const GEN_STYLES = { roots: 'Root network', fluid: 'Fluid bands', cells: 'Cell membrane' };

export const GEN_PARAMS = [
  { key: 'density', label: 'Density', min: 0.2, max: 4, step: 0.01, def: 1 },
  { key: 'movement', label: 'Movement', min: 0, max: 2, step: 0.01, def: 0.3 },
  { key: 'distortion', label: 'Distortion', min: 0, max: 1.5, step: 0.01, def: 0.5 },
  { key: 'thickness', label: 'Line thickness', min: 0.02, max: 0.6, step: 0.005, def: 0.14 },
  { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.01, def: 0.5 },
  { key: 'green', label: 'Green mix', min: 0, max: 1, step: 0.01, def: 0.6 },
  { key: 'growth', label: 'Growth', min: 0, max: 1, step: 0.005, def: 1 },
  { key: 'seed', label: 'Seed', min: 0, max: 100, step: 0.1, def: 7 },
];

// growSeconds > 0 keys the Growth parameter 0 → 1 so the pattern grows in. blend/transparent let a generator sit on footage.
export const GEN_PRESETS = [
  { name: 'Root Growth (overlay)', style: 'roots', growSeconds: 3, transparent: true, blend: 'screen', fx: ['grain'], params: { density: 0.75, movement: 0.2, distortion: 0.55, thickness: 0.16, glow: 0.7, green: 0.55 } },
  { name: 'Root Network (black)', style: 'roots', params: { density: 0.7, movement: 0.18, distortion: 0.6, thickness: 0.15, glow: 0.6, green: 0.5 }, fx: ['grain'] },
  { name: 'Mycelium Glow', style: 'roots', growSeconds: 4, params: { density: 1.4, movement: 0.3, distortion: 0.9, thickness: 0.1, glow: 0.9, green: 0.95, seed: 31 }, fx: ['bloom', 'grain'] },
  { name: 'Topo Water', style: 'fluid', params: { density: 1.0, movement: 0.5, distortion: 1.0, thickness: 0.12, glow: 0.4, green: 0.4 }, fx: ['chroma'] },
  { name: 'Cell Membrane', style: 'cells', growSeconds: 2.5, params: { density: 1.4, movement: 0.3, distortion: 0.6, thickness: 0.16, glow: 0.7, green: 0.7 }, fx: ['grain'] },
];

export function createGeneratorClip(preset, start, duration = 6) {
  const p = preset || GEN_PRESETS[0];
  const params = Object.fromEntries(GEN_PARAMS.map((d) => [d.key, d.def]));
  const keyframes = {};
  if (p.growSeconds) keyframes.growth = [{ t: 0, v: 0 }, { t: Math.min(p.growSeconds, duration), v: 1 }];
  const fxOverrides = { grain: { amount: 0.3 }, film: { halation: 0.3, grain: 0.3, lift: 0.04, vignette: 0.3 }, bloom: { intensity: 0.5, threshold: 0.4 }, chroma: { amount: 0.008 } };
  return createClip({
    type: 'generator',
    name: p.name,
    start,
    duration,
    gen: { style: p.style, transparent: !!p.transparent, params: { ...params, ...p.params }, keyframes, bindings: {} },
    props: { ...defaultProps(), blend: p.blend || 'normal' },
    effects: (p.fx || []).map((t) => createEffect(t, fxOverrides[t])),
  });
}
