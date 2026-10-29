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
  // ---- zine / vaporwave / brutalist / metal ----
  { name: 'Zine Cut-up', note: 'black photocopy with torn edges', chain: [fx('xerox', { contrast: 2.1, streaks: 0.55, dots: 0.5, ink: '#0d0d0d', paper: '#eee8da' }), fx('torn', { amount: 0.45, rough: 6, shadow: 0.6 })] },
  { name: 'Riso Pink', note: 'one-colour pink print on cream', chain: [fx('xerox', { contrast: 1.8, streaks: 0.25, dots: 0.6, size: 6, ink: '#ff2e88', paper: '#f6f0e4' }), fx('grain', { amount: 0.12, color: 0 })] },
  { name: 'Riso Blue', note: 'one-colour blue print on cream', chain: [fx('xerox', { contrast: 1.8, streaks: 0.25, dots: 0.6, size: 6, ink: '#2147ff', paper: '#f4f0e6' }), fx('grain', { amount: 0.12, color: 0 })] },
  { name: 'Vapor Sunset', note: 'lilac to hot pink to peach, soft glow', chain: [fx('gradmap', { shadow: '#1a0a3a', mid: '#ff4fa8', high: '#ffe9a8', contrast: 1.1 }), fx('bloom', { threshold: 0.55, intensity: 0.6, radius: 50 }), fx('chroma', { amount: 0.004 })] },
  { name: 'Vapor Tape', note: 'teal and magenta tape, scanlines', chain: [fx('gradmap', { shadow: '#06122e', mid: '#2fe0d0', high: '#ff9be8', contrast: 1.05 }), fx('vhs', { jitter: 0.15, bleed: 0.012, noise: 0.25, tracking: 0.2 }), fx('crt', { scan: 0.3, bleed: 0.004, curve: 0.04 })] },
  { name: 'City Pop Dusk', note: 'warm dusk, teal shadows, halation, grain', chain: [fx('color', { saturation: 1.15, contrast: 1.08, hue: -6, tint: 0.2 }), fx('film', { grain: 0.35, halation: 0.55 }), fx('bloom', { threshold: 0.65, intensity: 0.45, radius: 44 })] },
  { name: 'Concrete', note: 'grey, hard contrast, rough grain', chain: [fx('color', { saturation: 0.05, contrast: 1.35, brightness: -0.04 }), fx('grain', { amount: 0.45, size: 1.6, color: 0 })] },
  { name: 'Swiss Red', note: 'black, white and one hot red', chain: [fx('gradmap', { shadow: '#050505', mid: '#e5261f', high: '#f6f4ef', contrast: 1.3 }), fx('grain', { amount: 0.15, color: 0 })] },
  { name: 'Black Metal', note: 'bleached, crushed, heavy vignette, filthy grain', chain: [fx('color', { saturation: 0, contrast: 1.6, brightness: -0.06 }), fx('film', { grain: 0.7, vignette: 0.9, halation: 0.1 })] },
  { name: 'Blood Moon', note: 'black to deep red to pale bone', chain: [fx('gradmap', { shadow: '#050000', mid: '#7a0a0a', high: '#f0d9c6', contrast: 1.25 }), fx('bloom', { threshold: 0.7, intensity: 0.5, radius: 40 }), fx('grain', { amount: 0.25 })] },
  { name: 'Candlelit Crypt', note: 'amber flame light, dark stone, halation', chain: [fx('gradmap', { shadow: '#0c0602', mid: '#8a4a12', high: '#ffe2a8', contrast: 1.15 }), fx('film', { grain: 0.45, halation: 0.6, vignette: 0.7 })] },
  // ---- desi: patterns drawn by the Pattern effect (no pictures involved) ----
  { name: 'Mandala Bloom', note: 'a gold line mandala turning slowly over the picture', chain: [fx('color', { brightness: -0.12, contrast: 1.1 }), fx('pattern', { style: 0, scale: 1.15, detail: 12, speed: 0.06, line: 2, glow: 0.7, fill: 0.35, color: '#ffd27d', color2: '#c4162a', mix: 0.9 })] },
  { name: 'Jali Window', note: 'the picture seen through a carved stone lattice', chain: [fx('pattern', { style: 1, scale: 0.9, detail: 12, speed: 0.02, line: 2.5, glow: 0.2, fill: 0.5, color: '#f4e6c8', color2: '#0d0b10', mix: 1 }), fx('film', { grain: 0.25, halation: 0.3 })] },
  { name: 'Rangoli Floor', note: 'dot-and-loop rangoli glowing over a darkened picture', chain: [fx('color', { brightness: -0.2, saturation: 1.1 }), fx('pattern', { style: 2, scale: 1, speed: 0.04, line: 2.2, glow: 0.9, fill: 0.5, color: '#ff8fd0', color2: '#7a1b8c', mix: 0.95 })] },
  { name: 'Paisley Night', note: 'drifting gold paisleys on indigo', chain: [fx('gradmap', { shadow: '#07031c', mid: '#2a1b6e', high: '#c9b8ff', contrast: 1.1 }), fx('pattern', { style: 3, scale: 1, speed: 0.05, line: 2, glow: 0.5, fill: 0.55, color: '#ffd27d', color2: '#b0223f', mix: 0.9 }), fx('grain', { amount: 0.15 })] },
  { name: 'Truck-art Frame', note: 'a painted highway-truck border around the whole picture', chain: [fx('pattern', { style: 4, scale: 1, line: 2.2, glow: 0.3, fill: 0.9, color: '#ffe066', color2: '#d1002f', mix: 1 })] },
  { name: 'Marigold Haze', note: 'saturated saffron and magenta, bright bloom', chain: [fx('gradmap', { shadow: '#2a0316', mid: '#f0502a', high: '#ffe8a0', contrast: 1.15 }), fx('bloom', { threshold: 0.55, intensity: 0.7, radius: 46 }), fx('chroma', { amount: 0.005 }), fx('grain', { amount: 0.18 })] },
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

// Pattern layers that lockups lay behind their words (not listed in the Looks tab). They only add line work, they do not regrade the footage.
export const VEIL_LOOKS = [
  { name: 'Gold mandala veil', note: 'a slow gold line mandala behind a title', chain: [fx('pattern', { style: 0, scale: 1.25, detail: 12, speed: 0.05, line: 1.6, glow: 0.7, fill: 0.12, color: '#e8c36a', color2: '#7a2a10', mix: 0.55 })] },
  { name: 'Lattice veil', note: 'a stone-lattice window behind a title', chain: [fx('pattern', { style: 1, scale: 1.1, detail: 12, speed: 0.01, line: 1.8, glow: 0.2, fill: 0.2, color: '#d9c27a', color2: '#1a1208', mix: 0.28 })] },
  { name: 'Rangoli veil', note: 'glowing rangoli dots behind a title', chain: [fx('pattern', { style: 2, scale: 1.1, speed: 0.03, line: 1.8, glow: 0.8, fill: 0.2, color: '#ffb36b', color2: '#5a1a2a', mix: 0.35 })] },
  { name: 'Paisley veil', note: 'faint paisleys behind a title', chain: [fx('pattern', { style: 3, scale: 1.1, speed: 0.04, line: 1.6, glow: 0.3, fill: 0.2, color: '#e8c36a', color2: '#3a1a5a', mix: 0.3 })] },
  { name: 'Truck-art border veil', note: 'a painted truck border around the frame', chain: [fx('pattern', { style: 4, scale: 1, line: 2.2, glow: 0.2, fill: 0.9, color: '#ffe066', color2: '#d1002f', mix: 1 })] },
  { name: 'Xerox veil', note: 'photocopy grain behind a title', chain: [fx('xerox', { contrast: 1.6, streaks: 0.5, dots: 0.3, ink: '#0b0b0b', paper: '#e9e4d4', mix: 0.35 })] },
  { name: 'Scan veil', note: 'faint scanlines and a vignette', chain: [fx('crt', { scan: 0.22, bleed: 0.002, curve: 0.02 }), fx('film', { grain: 0.2, vignette: 0.55, halation: 0.1 })] },
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
