// Adjustment layers: a clip with no picture of its own. Its effect chain grades everything composited below it,
// so one layer gives a whole timeline (or one section of it) a look. Opacity mixes the graded result with the original.
import { createClip, defaultProps } from './project.js';
import { instantiatePreset } from './effects-defs.js';

const fx = (type, params, bindings, grow) => ({ type, params, bindings, grow });

export const ADJUST_LOOKS = [
  { name: 'Digicam 2002', note: 'blown highlights, soft CCD colour, date-stamp era', chain: [fx('bloom', { threshold: 0.5, intensity: 0.8, radius: 48 }), fx('chroma', { amount: 0.007 }), fx('color', { contrast: 1.18, saturation: 1.22, brightness: 0.04, hue: -4 }), fx('film', { grain: 0.3, halation: 0.1, lift: 0.05, vignette: 0.28, weave: 0 })] },
  { name: 'Chrome Haze', note: 'icy blue chrome with star glints', chain: [fx('gradmap', { shadow: '#070d24', mid: '#6f93e6', high: '#f4f8ff', contrast: 1.1 }), fx('glints', { threshold: 0.7, length: 150, intensity: 1.1, rotation: 0, tint: '#d6e6ff' }), fx('bloom', { threshold: 0.6, intensity: 0.6, radius: 60 }), fx('grain', { amount: 0.18 })] },
  { name: 'Frutiger Aero', note: 'glossy, saturated, sky-blue sparkle', chain: [fx('color', { saturation: 1.38, contrast: 1.06, brightness: 0.06, hue: -8 }), fx('bloom', { threshold: 0.5, intensity: 0.9, radius: 70 }), fx('glints', { threshold: 0.78, length: 110, intensity: 0.9, points: 2, rotation: 45, tint: '#bff0ff' })] },
  { name: 'Cyber CRT', note: 'scanlines, RGB bleed, cold magenta', chain: [fx('crt', { scan: 0.5, bleed: 0.012, curve: 0.12 }), fx('chroma', { amount: 0.011 }), fx('color', { saturation: 1.4, contrast: 1.2, hue: 18 }), fx('bloom', { threshold: 0.55, intensity: 0.7, radius: 40 })] },
  { name: 'Flash Camera', note: 'harsh on-camera flash, crushed night', chain: [fx('color', { contrast: 1.4, brightness: 0.06, saturation: 1.1 }), fx('bloom', { threshold: 0.72, intensity: 0.5, radius: 30 }), fx('film', { grain: 0.4, halation: 0.15, vignette: 0.5, lift: 0.02, weave: 0 })] },
  { name: 'Glints', note: 'only the star sparkles on every highlight', chain: [fx('glints', { threshold: 0.66, length: 160, intensity: 1.2, points: 2, rotation: 0, twinkle: 0.6 })] },
  { name: 'Anamorphic Night', note: 'long blue lens streaks across every light', chain: [fx('glints', { threshold: 0.62, length: 420, intensity: 1.5, points: 1, rotation: 0, twinkle: 0.1, tint: '#5f9bff' }), fx('bloom', { threshold: 0.6, intensity: 0.5, radius: 44 }), fx('color', { contrast: 1.12, saturation: 1.1 })] },
  { name: 'Holo Foil', note: 'liquid rainbow foil over the whole frame', chain: [fx('holo', { strength: 0.8, scale: 2, shimmer: 0.25 }), fx('glints', { threshold: 0.8, length: 90, intensity: 0.8 }), fx('grain', { amount: 0.12 })] },
  { name: 'Handheld 1-bit', note: 'dithered 4-shade green handheld screen', chain: [fx('dither', { palette: 1, levels: 4, size: 3 }), fx('crt', { scan: 0.12, bleed: 0, curve: 0.04 })] },
  { name: 'Amber Terminal', note: 'dithered amber phosphor monitor', chain: [fx('dither', { palette: 2, levels: 5, size: 2 }), fx('crt', { scan: 0.35, bleed: 0.004, curve: 0.1 }), fx('bloom', { threshold: 0.5, intensity: 0.7, radius: 30 })] },
  { name: 'Camcorder', note: 'REC badge, timecode, focus frame, tape wobble', chain: [fx('vhs', { jitter: 0.18, bleed: 0.01, noise: 0.25, tracking: 0.15 }), fx('color', { saturation: 1.15, contrast: 1.08 }), fx('hud', { style: 0, grid: 0.12 })] },
  { name: 'Thermal Lock', note: 'heat-map colour with a rotating target lock', chain: [fx('gradmap', { shadow: '#10003a', mid: '#e0200a', high: '#fff27a', contrast: 1.5 }), fx('grain', { amount: 0.2 }), fx('hud', { style: 1, color: '#ffffff', grid: 0 })] },
  { name: 'Kaleido Trip', note: 'six-way mirror that slowly turns', chain: [fx('kaleido', { segments: 6, spin: 8, zoom: 1.1 }), fx('chroma', { amount: 0.008 }), fx('bloom', { threshold: 0.8, intensity: 0.35, radius: 44 })] },
  { name: '3D · Footage Cube', note: 'your picture wrapped on a slowly turning cube', chain: [fx('object3d', { shape: 0, material: 0, background: 1, size: 1.1, ry: 30, sy: 30 })] },
  { name: '3D · Chrome Sphere', note: 'liquid-metal ball floating over the picture', chain: [fx('object3d', { shape: 1, material: 1, background: 0, size: 1.2, sy: 20, shine: 1 }), fx('bloom', { threshold: 0.75, intensity: 0.4, radius: 40 })] },
  { name: '3D · Glass Torus', note: 'a glass ring that bends the footage behind it', chain: [fx('object3d', { shape: 2, material: 2, background: 0, size: 1.4, rx: 55, sy: 25, sx: 12 }), fx('chroma', { amount: 0.004 })] },
  { name: '3D · Wire Cube', note: 'neon wireframe cube, the picture ghosted inside', chain: [fx('object3d', { shape: 3, material: 3, background: 1, size: 1.2, tint: '#6dffd0', sy: 40 }), fx('bloom', { threshold: 0.6, intensity: 0.7, radius: 30 })] },
  { name: '3D · Holo Pill', note: 'iridescent capsule drifting through the frame', chain: [fx('object3d', { shape: 4, material: 4, background: 0, size: 1.3, rz: 35, sy: 28, sx: 10 })] },
  { name: 'Synthwave Grid', note: 'sunset sky and a neon floor rushing at you', chain: [fx('grid3d', { horizon: 0.42, sky: 1, speed: 0.6 }), fx('bloom', { threshold: 0.7, intensity: 0.5, radius: 40 }), fx('crt', { scan: 0.15, bleed: 0.006, curve: 0.05 })] },
  { name: 'Grid Floor (over footage)', note: 'neon floor lines only, your picture stays as the sky', chain: [fx('grid3d', { horizon: 0.38, sky: 0, floor: 0.35, speed: 0.5, color: '#7dffb0', color2: '#38e1ff' }), fx('bloom', { threshold: 0.7, intensity: 0.45, radius: 36 })] },
  { name: 'Mall Tape', note: 'tired VHS, pink shadows', chain: [fx('vhs', { jitter: 0.25, bleed: 0.014, noise: 0.35, tracking: 0.3 }), fx('color', { saturation: 1.2, contrast: 1.1, hue: -12 }), fx('bloom', { threshold: 0.6, intensity: 0.5 })] },
  // ---- underground / street ----
  { name: 'Xerox Flyer', note: 'black toner on cheap paper — streaks, dots, no mercy', chain: [fx('xerox', { contrast: 2.4, threshold: 0.5, streaks: 0.5, dots: 0.45 }), fx('grain', { amount: 0.18, color: 0 })] },
  { name: 'Xerox Red', note: 'the same photocopy in red ink', chain: [fx('xerox', { contrast: 2.2, ink: '#c1121f', paper: '#efe9dc', streaks: 0.4, dots: 0.5 })] },
  { name: 'Newsprint', note: 'coarse black-and-white halftone, like a gig-poster scan', chain: [fx('color', { saturation: 0, contrast: 1.5 }), fx('halftone', { size: 6, contrast: 1.7, mix: 1 }), fx('grain', { amount: 0.3, color: 0 })] },
  { name: 'Fisheye Cam', note: 'skate-video fisheye with tape wobble', chain: [fx('fisheye', { amount: 0.7, vignette: 0.45, chroma: 0.012 }), fx('vhs', { jitter: 0.12, bleed: 0.008, noise: 0.2, tracking: 0.12 }), fx('color', { contrast: 1.15, saturation: 1.1 })] },
  { name: 'Basement Flash', note: 'harsh direct flash, crushed room, wide lens', chain: [fx('fisheye', { amount: 0.45, vignette: 0.55, chroma: 0.006 }), fx('color', { contrast: 1.5, brightness: 0.05, saturation: 1.05 }), fx('bloom', { threshold: 0.72, intensity: 0.45, radius: 36 }), fx('grain', { amount: 0.22 })] },
  { name: 'Night CCTV', note: 'green security-camera feed with a REC overlay', chain: [fx('gradmap', { shadow: '#02140a', mid: '#2f7a4a', high: '#c9ffd8', contrast: 1.25 }), fx('crt', { scan: 0.5, bleed: 0.004, curve: 0.05 }), fx('grain', { amount: 0.3 }), fx('hud', {})] },
  { name: 'Basement Tape', note: 'worn tape, pulled-down colour, halation', chain: [fx('vhs', { jitter: 0.3, bleed: 0.014, noise: 0.4, tracking: 0.35 }), fx('color', { saturation: 0.7, contrast: 1.25, brightness: -0.04 }), fx('film', { grain: 0.5, halation: 0.25 })] },
  { name: 'Torn Frame', note: 'the whole picture torn out of the page', chain: [fx('torn', { amount: 0.6, rough: 7, rim: 0.009, shadow: 0.5 })] },
  { name: 'Bass Drop (beat)', note: 'frame punches, splits and flares on every beat (needs music analysed)', chain: [fx('shake', { amount: 0.004, zoom: 1.04 }, { amount: { source: 'beat', amount: 0.6 }, zoom: { source: 'beat', amount: 0.25 } }), fx('chroma', { amount: 0.003 }, { amount: { source: 'bass', amount: 0.6 } }), fx('flash', { amount: 0.5, rate: 0.5, decay: 1, white: 1 }, { amount: { source: 'beat', amount: 0.5 } })] },
  { name: 'Beat Zoom', note: 'a soft zoom-in on every beat (needs music analysed)', chain: [fx('shake', { amount: 0, zoom: 1 }, { zoom: { source: 'beat', amount: 0.22 } })] },
  { name: 'Fade out to black', note: 'the last 1.5 s of the cut dips to black', fade: 'out', chain: [fx('color', { brightness: -1, contrast: 1 })] },
  { name: 'Fade in from black', note: 'the first 1.2 s rises from black', fade: 'in', chain: [fx('color', { brightness: -1, contrast: 1 })] },
  { name: 'Fade out to white', note: 'the last 1.5 s flares to white', fade: 'out', chain: [fx('color', { brightness: 1, contrast: 1 })] },
];

// Organic looks live INSIDE the picture: veins that grow in from an edge, take their light from the footage and bend it.
export const ORGANIC_LOOKS = [
  { name: 'Veins · Overgrown', note: 'green light creeping in from every edge', chain: [fx('veins', { mode: 0, origin: 5, density: 2.4, thickness: 0.16, glow: 1, color: '#7dffb0', seed: 7 }, {}, 5), fx('grain', { amount: 0.18 })] },
  { name: 'Veins · Glass', note: 'the frame cracks into lenses from the top', chain: [fx('veins', { mode: 1, origin: 0, density: 2, thickness: 0.22, warp: 1, glow: 0.8, color: '#e8f3ff', seed: 21 }, {}, 5), fx('chroma', { amount: 0.006 })] },
  { name: 'Veins · Negative', note: 'inverted channels spreading from the centre', chain: [fx('veins', { mode: 2, origin: 4, density: 3, thickness: 0.14, glow: 0.9, color: '#ff4fd8', seed: 33 }, {}, 4)] },
  { name: 'Veins · Burnt Channels', note: 'dark canals with a hot edge, rising from below', chain: [fx('veins', { mode: 3, origin: 1, density: 2.2, thickness: 0.2, glow: 1, color: '#ff8a3d', seed: 5 }, {}, 5), fx('film', { grain: 0.35, halation: 0.3, vignette: 0.35, weave: 0 })] },
  { name: 'Veins · Chrome Nerves', note: 'icy blue nerves with sparkle', chain: [fx('veins', { mode: 0, origin: 5, density: 3, thickness: 0.1, glow: 1.2, color: '#9fc2ff', seed: 12 }, {}, 4), fx('glints', { threshold: 0.8, length: 110, intensity: 0.9 }), fx('bloom', { threshold: 0.7, intensity: 0.5 })] },
  { name: 'Veins · Follow Edges', note: 'veins crawl along the outlines already in the picture', chain: [fx('veins', { mode: 0, origin: 5, density: 2.6, thickness: 0.14, glow: 1.1, cling: 0.85, color: '#8dffc0', seed: 14 }, {}, 5), fx('grain', { amount: 0.15 })] },
  { name: 'Spores · Bioluminescent', note: 'drifting seeds of light that catch the scene', chain: [fx('spores', { density: 1.1, glow: 1.4, speed: 0.3, lit: 0.7, color: '#c8ffd8' }), fx('bloom', { threshold: 0.55, intensity: 0.7, radius: 50 }), fx('color', { saturation: 1.1, contrast: 1.08 })] },
  { name: 'Cells · Glass', note: 'the frame divides into glass membrane cells', chain: [fx('cells', { scale: 9, lens: 0.6, glow: 0.8, nucleus: 0.4, drift: 0.25, color: '#b8ffd0' }, {}, undefined), fx('film', { grain: 0.25, halation: 0.3, vignette: 0.3, lift: 0.04, weave: 0 })] },
  { name: 'Lichen Bloom', note: 'veins + spores + glass cells, fully grown over the picture', chain: [fx('cells', { scale: 6, lens: 0.35, glow: 0.35, nucleus: 0, drift: 0.12, color: '#c8ffd8', mix: 0.8 }), fx('veins', { mode: 0, origin: 5, density: 2.2, thickness: 0.13, glow: 0.9, cling: 0.5, color: '#9dffb8', seed: 3 }, {}, 6), fx('spores', { density: 0.8, glow: 1, lit: 0.8 }), fx('grain', { amount: 0.15 })] },
  { name: 'Veins · Beat Pulse', note: 'fully grown, flaring on every beat (needs music)', chain: [fx('veins', { mode: 0, origin: 5, growth: 1, density: 2.6, thickness: 0.13, glow: 0.5, color: '#7dffb0', seed: 9 }, { glow: { source: 'beat', amount: 0.6 }, thickness: { source: 'beat', amount: 0.15 } })] },
];

export function createAdjustClip(look, start, duration = 8) {
  const l = look || ADJUST_LOOKS[0];
  return createClip({ type: 'adjust', name: `Adjust · ${l.name}`, start, duration, props: defaultProps(), effects: instantiatePreset(l) });
}
