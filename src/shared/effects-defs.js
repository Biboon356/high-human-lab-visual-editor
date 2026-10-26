// Effect registry: parameter metadata only. GLSL lives in renderer/engine/shaders.js.
// Param kinds: default numeric slider; `toggle: true` for 0/1 switches.
import { uid } from './project.js';

export const EFFECTS = {
  glitch: {
    label: 'Glitch',
    params: [
      { key: 'amount', label: 'Intensity', min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: 'blocks', label: 'Block size', min: 0.01, max: 0.4, step: 0.005, def: 0.08 },
      { key: 'split', label: 'RGB split', min: 0, max: 0.08, step: 0.001, def: 0.012 },
      { key: 'rate', label: 'Rate (Hz)', min: 1, max: 30, step: 1, def: 12 },
    ],
  },
  grain: {
    label: 'Grain',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.3 },
      { key: 'size', label: 'Size', min: 0.5, max: 6, step: 0.1, def: 1.5 },
      { key: 'color', label: 'Chroma grain', min: 0, max: 1, step: 0.01, def: 0.2 },
    ],
  },
  noise: {
    label: 'Cloud Noise',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.4 },
      { key: 'scale', label: 'Scale', min: 0.5, max: 20, step: 0.1, def: 4 },
      { key: 'speed', label: 'Speed', min: 0, max: 3, step: 0.01, def: 0.3 },
      { key: 'green', label: 'Green tint', min: 0, max: 1, step: 0.01, def: 0.3 },
    ],
  },
  distort: {
    label: 'Wave Distortion',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 0.2, step: 0.001, def: 0.02 },
      { key: 'freq', label: 'Frequency', min: 0.5, max: 40, step: 0.1, def: 8 },
      { key: 'speed', label: 'Speed', min: 0, max: 8, step: 0.05, def: 1.2 },
      { key: 'angle', label: 'Angle', min: 0, max: 180, step: 1, def: 0 },
    ],
  },
  fluid: {
    label: 'Fluid Warp',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 0.4, step: 0.001, def: 0.06 },
      { key: 'scale', label: 'Scale', min: 0.3, max: 10, step: 0.05, def: 2.2 },
      { key: 'speed', label: 'Speed', min: 0, max: 2, step: 0.01, def: 0.25 },
    ],
  },
  blur: {
    label: 'Blur',
    params: [
      { key: 'radius', label: 'Radius (px @1080p)', min: 0, max: 60, step: 0.5, def: 8 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 1 },
    ],
  },
  color: {
    label: 'Color',
    params: [
      { key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.01, def: 0 },
      { key: 'contrast', label: 'Contrast', min: 0, max: 3, step: 0.01, def: 1 },
      { key: 'saturation', label: 'Saturation', min: 0, max: 3, step: 0.01, def: 1 },
      { key: 'hue', label: 'Hue shift', min: -180, max: 180, step: 1, def: 0 },
      { key: 'tint', label: 'Forest tint', min: 0, max: 1, step: 0.01, def: 0 },
      { key: 'levels', label: 'Posterize', min: 2, max: 32, step: 1, def: 32 },
      { key: 'invert', label: 'Invert', min: 0, max: 1, step: 1, def: 0, toggle: true },
    ],
  },
  crt: {
    label: 'Broadcast / CRT',
    params: [
      { key: 'scan', label: 'Scanlines', min: 0, max: 1, step: 0.01, def: 0.4 },
      { key: 'lines', label: 'Line count', min: 120, max: 1080, step: 10, def: 540 },
      { key: 'bleed', label: 'Chroma bleed', min: 0, max: 0.03, step: 0.0005, def: 0.006 },
      { key: 'curve', label: 'Curvature', min: 0, max: 0.3, step: 0.005, def: 0.08 },
      { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, def: 0.4 },
      { key: 'flicker', label: 'Flicker', min: 0, max: 0.5, step: 0.01, def: 0.06 },
    ],
  },
};

export function defaultParams(type) {
  return Object.fromEntries(EFFECTS[type].params.map((p) => [p.key, p.def]));
}

export function createEffect(type, overrides = {}) {
  if (!EFFECTS[type]) throw new Error(`Unknown effect type: ${type}`);
  return {
    id: uid('fx'),
    type,
    enabled: true,
    params: { ...defaultParams(type), ...overrides },
    keyframes: {},
    bindings: {},
  };
}

const fx = (type, o) => ({ type, params: o });

/** Built-in chain presets. Applying one appends fresh effect instances. */
export const EFFECT_PRESETS = [
  { name: 'Broadcast Decay', chain: [fx('crt', { scan: 0.55, bleed: 0.01, curve: 0.1 }), fx('grain', { amount: 0.25 }), fx('color', { saturation: 0.8, contrast: 1.1 })] },
  { name: 'Tape Glitch', chain: [fx('glitch', { amount: 0.6, split: 0.02 }), fx('crt', { scan: 0.3 }), fx('color', { contrast: 1.2, saturation: 1.2 })] },
  { name: 'Root Bloom', chain: [fx('fluid', { amount: 0.09, scale: 2.8 }), fx('color', { tint: 0.5, contrast: 1.15, saturation: 0.6 }), fx('grain', { amount: 0.2 })] },
  { name: 'Dream Haze', chain: [fx('blur', { radius: 14 }), fx('noise', { amount: 0.35, green: 0.4 }), fx('color', { brightness: 0.05, saturation: 1.3 })] },
  { name: 'Night Photocopy', chain: [fx('color', { saturation: 0, contrast: 2, levels: 4 }), fx('grain', { amount: 0.5, size: 2.2, color: 0 })] },
  { name: 'Wet Signal', chain: [fx('distort', { amount: 0.03, freq: 6 }), fx('glitch', { amount: 0.25, rate: 6 }), fx('color', { hue: -25, tint: 0.3 })] },
];

export function instantiatePreset(preset) {
  return preset.chain.map((e) => createEffect(e.type, e.params));
}
