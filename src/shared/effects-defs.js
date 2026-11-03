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
  chroma: {
    label: 'Lens Chromatic',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 0.08, step: 0.0005, def: 0.012 },
      { key: 'radial', label: 'Radial ↔ Linear', min: 0, max: 1, step: 0.01, def: 1 },
      { key: 'angle', label: 'Angle', min: 0, max: 180, step: 1, def: 0 },
    ],
  },
  bloom: {
    label: 'Bloom',
    params: [
      { key: 'threshold', label: 'Threshold', min: 0, max: 0.95, step: 0.01, def: 0.55 },
      { key: 'intensity', label: 'Intensity', min: 0, max: 2, step: 0.01, def: 0.6 },
      { key: 'radius', label: 'Radius (px @1080p)', min: 2, max: 120, step: 1, def: 36 },
    ],
  },
  glints: {
    label: 'Glints (star sparkle)',
    params: [
      { key: 'threshold', label: 'Threshold', min: 0.2, max: 0.98, step: 0.01, def: 0.72 },
      { key: 'length', label: 'Ray length (px @1080p)', min: 10, max: 600, step: 1, def: 120 },
      { key: 'intensity', label: 'Intensity', min: 0, max: 3, step: 0.01, def: 1 },
      { key: 'points', label: 'Rays (2 per line)', min: 1, max: 3, step: 1, def: 2 },
      { key: 'rotation', label: 'Rotation', min: 0, max: 180, step: 1, def: 0 },
      { key: 'twinkle', label: 'Twinkle', min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: 'tint', label: 'Tint', kind: 'color', def: '#cfe3ff' },
    ],
  },
  veins: {
    label: 'Veins (grows on the image)',
    params: [
      { key: 'mode', label: 'Mode', options: ['Glow', 'Refract', 'Invert inside', 'Cutout'], def: 0 },
      { key: 'origin', label: 'Grows from', options: ['Top', 'Bottom', 'Left', 'Right', 'Center', 'All edges'], def: 5 },
      { key: 'growth', label: 'Growth', min: 0, max: 1, step: 0.005, def: 1 },
      { key: 'density', label: 'Density', min: 0.5, max: 8, step: 0.05, def: 2.4 },
      { key: 'thickness', label: 'Thickness', min: 0.02, max: 0.6, step: 0.005, def: 0.16 },
      { key: 'warp', label: 'Wander', min: 0, max: 2, step: 0.01, def: 0.9 },
      { key: 'flow', label: 'Flow / pulse', min: 0, max: 3, step: 0.01, def: 0.5 },
      { key: 'glow', label: 'Glow / strength', min: 0, max: 2, step: 0.01, def: 0.9 },
      { key: 'cling', label: 'Cling to edges', min: 0, max: 1, step: 0.01, def: 0 },
      { key: 'seed', label: 'Seed', min: 0, max: 100, step: 0.1, def: 7 },
      { key: 'color', label: 'Vein colour', kind: 'color', def: '#7dffb0' },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 1 },
    ],
  },
  dither: {
    label: 'Dither (1-bit / handheld)',
    params: [
      { key: 'palette', label: 'Palette', options: ['Mono', 'Handheld green', 'Amber terminal', 'Ink on paper', 'Keep colour'], def: 1 },
      { key: 'levels', label: 'Levels', min: 2, max: 8, step: 1, def: 4 },
      { key: 'size', label: 'Dot size (px @1080p)', min: 1, max: 10, step: 1, def: 3 },
      { key: 'ink', label: 'Ink', kind: 'color', def: '#1a1530' },
      { key: 'paper', label: 'Paper', kind: 'color', def: '#f2ecd8' },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 1 },
    ],
  },
  holo: {
    label: 'Holo Foil (iridescent)',
    params: [
      { key: 'strength', label: 'Strength', min: 0, max: 1.5, step: 0.01, def: 0.7 },
      { key: 'scale', label: 'Band density', min: 0.3, max: 8, step: 0.05, def: 2 },
      { key: 'angle', label: 'Angle', min: 0, max: 180, step: 1, def: 35 },
      { key: 'warp', label: 'Liquid warp', min: 0, max: 2, step: 0.01, def: 0.8 },
      { key: 'shimmer', label: 'Shimmer speed', min: 0, max: 2, step: 0.01, def: 0.25 },
      { key: 'pastel', label: 'Pastel', min: 0, max: 1, step: 0.01, def: 0.45 },
      { key: 'sparkle', label: 'Sparkle', min: 0, max: 1, step: 0.01, def: 0.3 },
    ],
  },
  kaleido: {
    label: 'Kaleidoscope / Mirror',
    params: [
      { key: 'segments', label: 'Segments', min: 2, max: 16, step: 1, def: 6 },
      { key: 'rotation', label: 'Rotation', min: -180, max: 180, step: 1, def: 0 },
      { key: 'spin', label: 'Spin (deg/s)', min: -90, max: 90, step: 0.5, def: 0 },
      { key: 'zoom', label: 'Zoom', min: 0.3, max: 3, step: 0.01, def: 1 },
      { key: 'cx', label: 'Centre X', min: 0, max: 1, step: 0.005, def: 0.5 },
      { key: 'cy', label: 'Centre Y', min: 0, max: 1, step: 0.005, def: 0.5 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 1 },
    ],
  },
  spores: {
    label: 'Spores (floating light)',
    params: [
      { key: 'density', label: 'Density', min: 0.2, max: 4, step: 0.01, def: 1 },
      { key: 'size', label: 'Size', min: 0.3, max: 3, step: 0.01, def: 1 },
      { key: 'speed', label: 'Drift speed', min: 0, max: 2, step: 0.01, def: 0.35 },
      { key: 'glow', label: 'Glow', min: 0, max: 3, step: 0.01, def: 1.2 },
      { key: 'flicker', label: 'Flicker', min: 0, max: 1, step: 0.01, def: 0.4 },
      { key: 'lit', label: 'Lit by the picture', min: 0, max: 1, step: 0.01, def: 0.6 },
      { key: 'color', label: 'Colour', kind: 'color', def: '#c8ffd8' },
    ],
  },
  cells: {
    label: 'Cells (membrane glass)',
    params: [
      { key: 'scale', label: 'Cell count', min: 2, max: 40, step: 0.1, def: 9 },
      { key: 'lens', label: 'Lens (refraction)', min: 0, max: 1.5, step: 0.01, def: 0.5 },
      { key: 'edge', label: 'Membrane width', min: 0.005, max: 0.2, step: 0.001, def: 0.04 },
      { key: 'glow', label: 'Membrane glow', min: 0, max: 2, step: 0.01, def: 0.8 },
      { key: 'nucleus', label: 'Nuclei', min: 0, max: 1, step: 0.01, def: 0.4 },
      { key: 'drift', label: 'Drift', min: 0, max: 1, step: 0.01, def: 0.25 },
      { key: 'color', label: 'Membrane colour', kind: 'color', def: '#b8ffd0' },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 1 },
    ],
  },
  hud: {
    label: 'Viewfinder HUD',
    params: [
      { key: 'style', label: 'Style', options: ['Camcorder', 'Target lock', 'Corners only'], def: 0 },
      { key: 'scale', label: 'Size', min: 0.5, max: 2.5, step: 0.01, def: 1 },
      { key: 'rec', label: 'REC / PLAY badge', min: 0, max: 1, step: 1, def: 1, toggle: true },
      { key: 'timecode', label: 'Timecode', min: 0, max: 1, step: 1, def: 1, toggle: true },
      { key: 'grid', label: 'Rule-of-thirds grid', min: 0, max: 1, step: 0.01, def: 0.15 },
      { key: 'color', label: 'Colour', kind: 'color', def: '#ffffff' },
      { key: 'alert', label: 'Alert colour', kind: 'color', def: '#ff2a2a' },
    ],
  },
  crop: {
    label: 'Crop',
    params: [
      { key: 'left', label: 'Left', min: 0, max: 0.9, step: 0.001, def: 0 },
      { key: 'right', label: 'Right', min: 0, max: 0.9, step: 0.001, def: 0 },
      { key: 'top', label: 'Top', min: 0, max: 0.9, step: 0.001, def: 0 },
      { key: 'bottom', label: 'Bottom', min: 0, max: 0.9, step: 0.001, def: 0 },
      { key: 'round', label: 'Corner radius', min: 0, max: 0.5, step: 0.005, def: 0 },
      { key: 'feather', label: 'Feather', min: 0, max: 0.2, step: 0.002, def: 0 },
    ],
  },
  xerox: {
    label: 'Xerox (photocopy)',
    params: [
      { key: 'contrast', label: 'Contrast', min: 0.5, max: 5, step: 0.05, def: 2.2 },
      { key: 'threshold', label: 'Black point', min: 0.15, max: 0.85, step: 0.01, def: 0.5 },
      { key: 'streaks', label: 'Toner streaks', min: 0, max: 1, step: 0.01, def: 0.45 },
      { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: 'dots', label: 'Halftone dots', min: 0, max: 1, step: 0.01, def: 0.4 },
      { key: 'size', label: 'Dot size (px)', min: 2, max: 16, step: 0.5, def: 5 },
      { key: 'ink', label: 'Ink', kind: 'color', def: '#0b0b0b' },
      { key: 'paper', label: 'Paper', kind: 'color', def: '#f1efe6' },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 1 },
    ],
  },
  fisheye: {
    label: 'Fisheye lens',
    params: [
      { key: 'amount', label: 'Bulge', min: -0.6, max: 1.5, step: 0.01, def: 0.55 },
      { key: 'zoom', label: 'Zoom', min: 0.5, max: 2, step: 0.01, def: 1 },
      { key: 'chroma', label: 'Colour fringe', min: 0, max: 0.05, step: 0.001, def: 0.01 },
      { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, def: 0.35 },
    ],
  },
  torn: {
    label: 'Torn paper edge',
    params: [
      { key: 'amount', label: 'How torn', min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: 'rough', label: 'Roughness', min: 1, max: 24, step: 0.5, def: 7 },
      { key: 'rim', label: 'Paper rim', min: 0, max: 0.03, step: 0.001, def: 0.009 },
      { key: 'shadow', label: 'Shadow', min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: 'seed', label: 'Seed', min: 0, max: 50, step: 1, def: 3 },
      { key: 'paper', label: 'Paper colour', kind: 'color', def: '#ece6d6' },
    ],
  },
  pattern: {
    label: 'Pattern (mandala, lotus, jali, rangoli, paisley, henna, diya, borders)',
    params: [
      { key: 'style', label: 'Pattern', options: ['Mandala', 'Jali lattice', 'Rangoli dots', 'Paisley field', 'Truck-art frame', 'Lotus mandala', 'Henna vines', 'Diya row', 'Zari border', 'Torana garland'], def: 0 },
      { key: 'scale', label: 'Size / repeat', min: 0.2, max: 4, step: 0.01, def: 1 },
      { key: 'detail', label: 'Detail (petals / layers)', min: 4, max: 24, step: 1, def: 12 },
      { key: 'rotate', label: 'Rotate (deg)', min: -180, max: 180, step: 1, def: 0 },
      { key: 'speed', label: 'Drift / spin', min: -1, max: 1, step: 0.01, def: 0.08 },
      { key: 'line', label: 'Line width (px)', min: 0.5, max: 10, step: 0.1, def: 2 },
      { key: 'glow', label: 'Glow', min: 0, max: 2, step: 0.01, def: 0.6 },
      { key: 'fill', label: 'Fill', min: 0, max: 1, step: 0.01, def: 0.4 },
      { key: 'foil', label: 'Gold-leaf shading', min: 0, max: 1, step: 0.01, def: 0 },
      { key: 'color', label: 'Line colour', kind: 'color', def: '#ffd27d' },
      { key: 'color2', label: 'Fill colour', kind: 'color', def: '#c4162a' },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 1 },
    ],
  },
  object3d: {
    label: '3D Object (wrap the picture on a shape)',
    params: [
      { key: 'shape', label: 'Shape', options: ['Cube', 'Sphere', 'Torus', 'Rounded cube', 'Capsule', 'Octahedron'], def: 0 },
      { key: 'material', label: 'Material', options: ['Footage', 'Chrome', 'Glass', 'Wireframe', 'Holo'], def: 0 },
      { key: 'background', label: 'Background', options: ['Keep picture', 'Dim picture', 'Black', 'Transparent'], def: 1 },
      { key: 'size', label: 'Size', min: 0.2, max: 2.4, step: 0.01, def: 1 },
      { key: 'x', label: 'Position X', min: -1.5, max: 1.5, step: 0.005, def: 0 },
      { key: 'y', label: 'Position Y', min: -1, max: 1, step: 0.005, def: 0 },
      { key: 'rx', label: 'Tilt X', min: -180, max: 180, step: 0.5, def: 20 },
      { key: 'ry', label: 'Turn Y', min: -180, max: 180, step: 0.5, def: 30 },
      { key: 'rz', label: 'Roll Z', min: -180, max: 180, step: 0.5, def: 0 },
      { key: 'sx', label: 'Spin X (deg/s)', min: -180, max: 180, step: 1, def: 0 },
      { key: 'sy', label: 'Spin Y (deg/s)', min: -180, max: 180, step: 1, def: 35 },
      { key: 'sz', label: 'Spin Z (deg/s)', min: -180, max: 180, step: 1, def: 0 },
      { key: 'shine', label: 'Shine', min: 0, max: 2, step: 0.01, def: 0.8 },
      { key: 'tint', label: 'Tint', kind: 'color', def: '#d8e4ff' },
    ],
  },
  grid3d: {
    label: 'Retro Grid Floor (synthwave)',
    params: [
      { key: 'horizon', label: 'Horizon', min: 0.15, max: 0.85, step: 0.005, def: 0.42 },
      { key: 'scale', label: 'Cell size', min: 2, max: 40, step: 0.1, def: 12 },
      { key: 'speed', label: 'Speed', min: -3, max: 3, step: 0.01, def: 0.6 },
      { key: 'line', label: 'Line weight', min: 0.2, max: 4, step: 0.01, def: 1.2 },
      { key: 'glow', label: 'Glow', min: 0, max: 3, step: 0.01, def: 1.2 },
      { key: 'sky', label: 'Sky', options: ['Keep picture', 'Sunset + sun'], def: 1 },
      { key: 'floor', label: 'Floor fill', min: 0, max: 1, step: 0.01, def: 0.6 },
      { key: 'color', label: 'Line colour', kind: 'color', def: '#ff4fd8' },
      { key: 'color2', label: 'Horizon glow', kind: 'color', def: '#38e1ff' },
    ],
  },
  film: {
    label: 'Film 35mm',
    params: [
      { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.01, def: 0.35 },
      { key: 'halation', label: 'Halation', min: 0, max: 1, step: 0.01, def: 0.25 },
      { key: 'contrast', label: 'S-curve', min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: 'lift', label: 'Faded blacks', min: 0, max: 0.5, step: 0.01, def: 0.1 },
      { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, def: 0.35 },
      { key: 'weave', label: 'Gate weave', min: 0, max: 1, step: 0.01, def: 0.4 },
    ],
  },
  vhs: {
    label: 'VHS Tape',
    params: [
      { key: 'jitter', label: 'Line jitter', min: 0, max: 1, step: 0.01, def: 0.35 },
      { key: 'bleed', label: 'Chroma bleed', min: 0, max: 0.05, step: 0.0005, def: 0.012 },
      { key: 'noise', label: 'Tape noise', min: 0, max: 1, step: 0.01, def: 0.4 },
      { key: 'tracking', label: 'Tracking error', min: 0, max: 1, step: 0.01, def: 0.5 },
    ],
  },
  mosh: {
    label: 'Mosh / Smear',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.45 },
      { key: 'block', label: 'Block size (px)', min: 4, max: 128, step: 1, def: 32 },
      { key: 'hold', label: 'Change rate (Hz)', min: 0.5, max: 24, step: 0.5, def: 6 },
      { key: 'smear', label: 'Smear length', min: 0, max: 3, step: 0.05, def: 1.2 },
    ],
  },
  halftone: {
    label: 'Halftone',
    params: [
      { key: 'size', label: 'Dot size (px)', min: 3, max: 40, step: 0.5, def: 10 },
      { key: 'angle', label: 'Angle', min: 0, max: 90, step: 1, def: 30 },
      { key: 'contrast', label: 'Dot gain', min: 0.5, max: 3, step: 0.01, def: 1.4 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 1 },
    ],
  },
  pixel: {
    label: 'Pixelate',
    params: [
      { key: 'size', label: 'Pixel size', min: 1, max: 96, step: 1, def: 12 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 1 },
    ],
  },
  shake: {
    label: 'Camera Shake / Punch',
    params: [
      { key: 'amount', label: 'Shake', min: 0, max: 0.1, step: 0.001, def: 0.012 },
      { key: 'speed', label: 'Speed', min: 0.2, max: 12, step: 0.1, def: 4 },
      { key: 'zoom', label: 'Zoom', min: 1, max: 1.6, step: 0.005, def: 1.06 },
      { key: 'roll', label: 'Roll (deg)', min: 0, max: 12, step: 0.1, def: 0.8 },
    ],
  },
  flash: {
    label: 'Colour Flash',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 1.5, step: 0.01, def: 0.6 },
      { key: 'rate', label: 'Rate (Hz)', min: 0.25, max: 16, step: 0.25, def: 2 },
      { key: 'decay', label: 'Decay', min: 1, max: 12, step: 0.1, def: 5 },
      { key: 'hue', label: 'Hue', min: 0, max: 1, step: 0.005, def: 0.38 },
      { key: 'white', label: 'White ↔ Hue', min: 0, max: 1, step: 0.01, def: 0.5 },
    ],
  },
  gradmap: {
    label: 'Gradient Map (duotone)',
    params: [
      { key: 'shadow', label: 'Shadows', kind: 'color', def: '#05010f' },
      { key: 'mid', label: 'Midtones', kind: 'color', def: '#4a1fa8' },
      { key: 'high', label: 'Highlights', kind: 'color', def: '#f1e9ff' },
      { key: 'midpos', label: 'Mid position', min: 0.1, max: 0.9, step: 0.01, def: 0.5 },
      { key: 'contrast', label: 'Contrast', min: 0.5, max: 3, step: 0.01, def: 1.2 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 1 },
    ],
  },
  threshold: {
    label: 'Xerox Threshold',
    params: [
      { key: 'level', label: 'Level', min: 0, max: 1, step: 0.005, def: 0.5 },
      { key: 'soft', label: 'Softness', min: 0.005, max: 0.5, step: 0.005, def: 0.2 },
      { key: 'noise', label: 'Toner noise', min: 0, max: 1.5, step: 0.01, def: 0.6 },
      { key: 'ink', label: 'Ink', kind: 'color', def: '#050505' },
      { key: 'paper', label: 'Paper', kind: 'color', def: '#f2f0ea' },
      { key: 'invert', label: 'Invert', min: 0, max: 1, step: 1, def: 0, toggle: true },
    ],
  },
  solarize: {
    label: 'Solarize / Channel Swap',
    params: [
      { key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.005, def: 0.5 },
      { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 1 },
      { key: 'rotate', label: 'Channel rotate', min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: 'hue', label: 'Hue shift', min: -180, max: 180, step: 1, def: 0 },
    ],
  },
  slices: {
    label: 'Slices / Cut Bars',
    params: [
      { key: 'bands', label: 'Bands', min: 2, max: 60, step: 1, def: 14 },
      { key: 'shift', label: 'Shift', min: 0, max: 0.6, step: 0.005, def: 0.08 },
      { key: 'black', label: 'Black bars', min: 0, max: 1, step: 0.01, def: 0.25 },
      { key: 'rate', label: 'Rate (Hz)', min: 0.5, max: 24, step: 0.5, def: 6 },
      { key: 'split', label: 'RGB split', min: 0, max: 0.05, step: 0.001, def: 0.008 },
    ],
  },
  mask: {
    label: 'Shape Mask (window)',
    params: [
      { key: 'shape', label: 'Shape', options: ['Circle', 'Rounded rect', 'Diamond', 'Blob'], def: 0 },
      { key: 'x', label: 'Position X', min: -1, max: 1, step: 0.005, def: 0 },
      { key: 'y', label: 'Position Y', min: -1, max: 1, step: 0.005, def: 0 },
      { key: 'size', label: 'Size', min: 0.03, max: 1.2, step: 0.005, def: 0.35 },
      { key: 'aspect', label: 'Aspect', min: 0.3, max: 3, step: 0.01, def: 1 },
      { key: 'rotate', label: 'Rotate', min: -180, max: 180, step: 1, def: 0 },
      { key: 'feather', label: 'Feather', min: 0, max: 1, step: 0.01, def: 0 },
      { key: 'wobble', label: 'Blob wobble', min: 0, max: 1, step: 0.01, def: 0.35 },
      { key: 'invert', label: 'Invert', min: 0, max: 1, step: 1, def: 0, toggle: true },
    ],
  },
  outline: {
    label: 'Sticker Outline (die-cut)',
    params: [
      { key: 'width', label: 'Width (px @1080p)', min: 0, max: 60, step: 0.5, def: 14 },
      { key: 'ink', label: 'Colour', kind: 'color', def: '#ffffff' },
      { key: 'soft', label: 'Edge softness', min: 0, max: 1, step: 0.01, def: 0.2 },
    ],
  },
  memory: {
    label: 'Memory Bleed (the image remembers)',
    params: [
      { key: 'mode', label: 'Mode', options: ['Ghost', 'Stain', 'Scar', 'Echo'], def: 0 },
      { key: 'length', label: 'Memory length (s)', min: 0.1, max: 6, step: 0.05, def: 1.2 },
      { key: 'decay', label: 'Decay (soft ↔ crisp tail)', min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: 'intensity', label: 'Intensity', min: 0, max: 1.5, step: 0.01, def: 0.8 },
      { key: 'blend', label: 'Blend', options: ['Behind (normal)', 'Screen', 'Add', 'Difference'], def: 1 },
      { key: 'spread', label: 'Drift / scatter', min: 0, max: 1, step: 0.01, def: 0.3 },
      { key: 'rate', label: 'Echo rate (Hz)', min: 0.25, max: 8, step: 0.25, def: 2 },
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

/**
 * Wet / dry for any effect: how much of its result is mixed over what came into it (1 = the effect alone, 0 = skipped).
 * Stored on the effect itself as `wet` (absent = 1, so older projects are unchanged), animatable under keyframes.wet / bindings.wet.
 */
export const WET = { key: 'wet', label: 'Wet / dry', min: 0, max: 1, step: 0.01, def: 1 };

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

const fx = (type, o, bindings = {}) => ({ type, params: o, bindings });

/** Built-in chain presets. Applying one appends fresh effect instances. */
export const EFFECT_PRESETS = [
  { name: 'Broadcast Decay', chain: [fx('crt', { scan: 0.55, bleed: 0.01, curve: 0.1 }), fx('grain', { amount: 0.25 }), fx('color', { saturation: 0.8, contrast: 1.1 })] },
  { name: 'Tape Glitch', chain: [fx('glitch', { amount: 0.6, split: 0.02 }), fx('crt', { scan: 0.3 }), fx('color', { contrast: 1.2, saturation: 1.2 })] },
  { name: 'Root Bloom', chain: [fx('fluid', { amount: 0.09, scale: 2.8 }), fx('color', { tint: 0.5, contrast: 1.15, saturation: 0.6 }), fx('grain', { amount: 0.2 })] },
  { name: 'Dream Haze', chain: [fx('blur', { radius: 14 }), fx('noise', { amount: 0.35, green: 0.4 }), fx('color', { brightness: 0.05, saturation: 1.3 })] },
  { name: 'Night Photocopy', chain: [fx('color', { saturation: 0, contrast: 2, levels: 4 }), fx('grain', { amount: 0.5, size: 2.2, color: 0 })] },
  { name: 'Mosh Pit', chain: [fx('mosh', { amount: 0.5, smear: 1.5 }), fx('chroma', { amount: 0.018 }), fx('film', { grain: 0.45, halation: 0.2 }), fx('color', { contrast: 1.2, saturation: 0.85 })] },
  { name: 'Tour Tape (VHS)', chain: [fx('vhs', { tracking: 0.55 }), fx('chroma', { amount: 0.01, radial: 0.4 }), fx('bloom', { intensity: 0.4 }), fx('color', { saturation: 1.25, contrast: 1.1 })] },
  { name: 'Halation 35mm', chain: [fx('film', { halation: 0.7, grain: 0.4 }), fx('bloom', { threshold: 0.7, intensity: 0.5, radius: 50 }), fx('chroma', { amount: 0.006 })] },
  { name: 'Beat Punch (audio)', chain: [fx('shake', { amount: 0.004, zoom: 1.08 }, { amount: { source: 'beat', amount: 0.5 } }), fx('chroma', { amount: 0.004 }, { amount: { source: 'beat', amount: 0.5 } }), fx('flash', { amount: 0.0, white: 0.8 }, { amount: { source: 'beat', amount: 0.35 } })] },
  { name: 'Acid Halftone', chain: [fx('halftone', { size: 9, contrast: 1.6 }), fx('color', { tint: 0.35, contrast: 1.3 }), fx('grain', { amount: 0.25 })] },
  { name: 'Low-Res Rave', chain: [fx('pixel', { size: 10 }), fx('glitch', { amount: 0.4, rate: 8 }), fx('chroma', { amount: 0.02 }), fx('color', { levels: 6, contrast: 1.4 })] },
  { name: 'Xerox Photocopy', chain: [fx('color', { saturation: 0, contrast: 1.5, brightness: 0.04 }), fx('threshold', { level: 0.48, soft: 0.28, noise: 0.8 }), fx('grain', { amount: 0.3, color: 0 })] },
  { name: 'Halftone Print (B&W)', chain: [fx('color', { saturation: 0, contrast: 1.6 }), fx('halftone', { size: 7, contrast: 1.8, mix: 1 }), fx('grain', { amount: 0.35, color: 0 }), fx('chroma', { amount: 0.004 })] },
  { name: 'Comic Flash (red/yellow)', chain: [fx('gradmap', { shadow: '#1a0000', mid: '#d8140f', high: '#ffe11a', contrast: 1.4 }), fx('halftone', { size: 8, contrast: 1.5, mix: 0.45 }), fx('grain', { amount: 0.3 })] },
  { name: 'Midnight Purple', chain: [fx('gradmap', {}), fx('halftone', { size: 9, mix: 0.3 }), fx('grain', { amount: 0.35 }), fx('chroma', { amount: 0.008 })] },
  { name: 'Neon Solarize', chain: [fx('solarize', { threshold: 0.45, rotate: 0.6, hue: 40 }), fx('color', { contrast: 1.3, saturation: 1.3 }), fx('slices', { bands: 12, shift: 0.05, black: 0.2 })] },
  { name: 'Die-Cut Sticker', chain: [fx('mask', { shape: 3, size: 0.36, wobble: 0.3 }), fx('outline', { width: 16, ink: '#ffffff' })] },
  { name: 'Circle Window', chain: [fx('mask', { shape: 0, size: 0.3 }), fx('outline', { width: 6, ink: '#ffffff', soft: 0.1 })] },
  { name: 'Wet Signal', chain: [fx('distort', { amount: 0.03, freq: 6 }), fx('glitch', { amount: 0.25, rate: 6 }), fx('color', { hue: -25, tint: 0.3 })] },
];

export function instantiatePreset(preset) {
  return preset.chain.map((e) => {
    const effect = createEffect(e.type, e.params);
    effect.bindings = structuredClone(e.bindings || {});
    if (e.grow) effect.keyframes.growth = [{ t: 0, v: 0 }, { t: e.grow, v: 1 }]; // grows in over `grow` seconds
    return effect;
  });
}
