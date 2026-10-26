// Organic Visual Engine: procedural generator clip definitions.
import { createClip, defaultProps } from './project.js';

export const GEN_STYLES = { roots: 'Root network', fluid: 'Fluid bands', cells: 'Cell membrane' };

export const GEN_PARAMS = [
  { key: 'density', label: 'Density', min: 0.2, max: 4, step: 0.01, def: 1 },
  { key: 'movement', label: 'Movement', min: 0, max: 2, step: 0.01, def: 0.3 },
  { key: 'distortion', label: 'Distortion', min: 0, max: 1.5, step: 0.01, def: 0.5 },
  { key: 'thickness', label: 'Line thickness', min: 0.02, max: 0.6, step: 0.005, def: 0.14 },
  { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.01, def: 0.5 },
  { key: 'green', label: 'Green mix', min: 0, max: 1, step: 0.01, def: 0.6 },
  { key: 'seed', label: 'Seed', min: 0, max: 100, step: 0.1, def: 7 },
];

export const GEN_PRESETS = [
  { name: 'Root Network', style: 'roots', params: { density: 1.1, movement: 0.25, distortion: 0.55, thickness: 0.12, glow: 0.5, green: 0.55 } },
  { name: 'Mycelium Glow', style: 'roots', params: { density: 2.4, movement: 0.4, distortion: 0.9, thickness: 0.08, glow: 0.9, green: 0.9, seed: 31 } },
  { name: 'Black Water', style: 'fluid', params: { density: 1.4, movement: 0.5, distortion: 1.0, thickness: 0.2, glow: 0.3, green: 0.4 } },
  { name: 'Cell Membrane', style: 'cells', params: { density: 1.6, movement: 0.3, distortion: 0.6, thickness: 0.18, glow: 0.6, green: 0.7 } },
];

export function createGeneratorClip(preset, start, duration = 6) {
  const p = preset || GEN_PRESETS[0];
  const params = Object.fromEntries(GEN_PARAMS.map((d) => [d.key, d.def]));
  return createClip({
    type: 'generator',
    name: p.name,
    start,
    duration,
    gen: { style: p.style, transparent: false, params: { ...params, ...p.params }, keyframes: {}, bindings: {} },
    props: { ...defaultProps() },
  });
}
