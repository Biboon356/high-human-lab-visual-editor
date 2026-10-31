// Organic Visual Engine: procedural generator clip definitions.
import { createClip, defaultProps } from './project.js';
import { createEffect } from './effects-defs.js';

export const GEN_STYLES = { tree: 'Root system (drawn)', roots: 'Contour network', fluid: 'Fluid bands', cells: 'Cell membrane', dust: 'Dust & scratches', trace: 'Hand trace (from the Living tab)' };

export const GEN_PARAMS = [
  { key: 'density', label: 'Density', min: 0.2, max: 4, step: 0.01, def: 1 },
  { key: 'movement', label: 'Movement', min: 0, max: 2, step: 0.01, def: 0.3 },
  { key: 'distortion', label: 'Distortion', min: 0, max: 1.5, step: 0.01, def: 0.5 },
  { key: 'thickness', label: 'Line thickness', min: 0.02, max: 0.6, step: 0.005, def: 0.14 },
  { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.01, def: 0.5 },
  { key: 'green', label: 'Green mix', min: 0, max: 1, step: 0.01, def: 0.6 },
  { key: 'origin', label: 'Grows from', options: ['Top (hanging roots)', 'Bottom (growing up)', 'Left', 'Center (radial)'], def: 0 },
  { key: 'boil', label: 'Hand-drawn boil (fps)', min: 0, max: 24, step: 1, def: 0 },
  { key: 'growth', label: 'Growth', min: 0, max: 1, step: 0.005, def: 1 },
  { key: 'seed', label: 'Seed', min: 0, max: 100, step: 0.1, def: 7 },
];

// growSeconds > 0 keys the Growth parameter 0 → 1 so the pattern grows in. blend/transparent let a generator sit on footage.
export const GEN_PRESETS = [
  { name: 'Root System (growing, overlay)', style: 'tree', growSeconds: 4, transparent: true, blend: 'screen', fx: ['grain'], params: { density: 1.1, movement: 0.3, distortion: 0.55, thickness: 0.25, glow: 0.7, green: 0.5, seed: 11, origin: 0 } },
  { name: 'Root System (rising, black)', style: 'tree', growSeconds: 5, params: { density: 0.9, movement: 0.25, distortion: 0.7, thickness: 0.25, glow: 0.8, green: 0.6, seed: 3, origin: 1 }, fx: ['grain'] },
  { name: 'Root System (radial)', style: 'tree', growSeconds: 4, transparent: true, blend: 'screen', params: { density: 1.3, movement: 0.2, distortion: 0.5, thickness: 0.22, glow: 0.8, green: 0.8, seed: 21, origin: 3 }, fx: ['bloom'] },
  { name: 'Root Growth (contours, overlay)', style: 'roots', growSeconds: 3, transparent: true, blend: 'screen', fx: ['grain'], params: { density: 0.75, movement: 0.2, distortion: 0.55, thickness: 0.16, glow: 0.7, green: 0.55 } },
  { name: 'Root Network (black)', style: 'roots', params: { density: 0.7, movement: 0.18, distortion: 0.6, thickness: 0.15, glow: 0.6, green: 0.5 }, fx: ['grain'] },
  { name: 'Mycelium Glow', style: 'roots', growSeconds: 4, params: { density: 1.4, movement: 0.3, distortion: 0.9, thickness: 0.1, glow: 0.9, green: 0.95, seed: 31 }, fx: ['bloom', 'grain'] },
  { name: 'Topo Water', style: 'fluid', params: { density: 1.0, movement: 0.5, distortion: 1.0, thickness: 0.12, glow: 0.4, green: 0.4 }, fx: ['chroma'] },
  { name: 'Scribble Contour (hand-drawn)', style: 'roots', transparent: true, blend: 'screen', params: { density: 0.55, movement: 0.5, distortion: 0.8, thickness: 0.2, glow: 0.15, green: 0.05, boil: 8 }, fx: [] },
  { name: 'Scribble Roots (hand-drawn)', style: 'tree', growSeconds: 3, transparent: true, blend: 'screen', params: { density: 1.0, movement: 0.5, distortion: 0.8, thickness: 0.18, glow: 0.2, green: 0.05, boil: 8, seed: 5, origin: 0 }, fx: [] },
  { name: 'Dust & Scratches (overlay)', style: 'dust', transparent: true, blend: 'screen', params: { density: 1.2, thickness: 0.2, glow: 0, green: 0 }, fx: [] },
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
