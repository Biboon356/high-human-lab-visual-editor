// The preset library: ready-made multi-effect chains grouped by mood, searchable, applied to a clip or as an adjustment layer.
// Every entry is {id, name, category, note, tags, chain:[{type, params, bindings?, grow?}]} — the same shape instantiatePreset() reads.
// `grow` = seconds for a Veins/growth parameter to key 0 → 1. bindings: {param: {source, amount}} (audio-reactive).
import { ADJUST_LOOKS, ORGANIC_LOOKS } from './adjust-defs.js';
import { EFFECT_PRESETS } from './effects-defs.js';

const fx = (type, params = {}, bindings, grow) => ({ type, params, bindings, grow });
const bind = (param, source, amount) => ({ [param]: { source, amount } });

const NEW = [];
const add = (category, name, note, chain, tags = []) => NEW.push({ category, name, note, chain, tags: [...tags, category.toLowerCase()] });

// ---- Y2K ------------------------------------------------------------------------------------------------------------
add('Y2K', 'Chrome Hour', 'icy chrome grade with star glints', [fx('gradmap', { shadow: '#070d24', mid: '#6f93e6', high: '#f4f8ff', contrast: 1.15 }), fx('bloom', { threshold: 0.6, intensity: 0.6, radius: 56 }), fx('glints', { threshold: 0.72, length: 140, intensity: 1.1 }), fx('grain', { amount: 0.15 })], ['chrome', 'blue']);
add('Y2K', 'Digicam Flash', 'on-camera flash, blown highlights, soft CCD colour', [fx('color', { contrast: 1.3, brightness: 0.06, saturation: 1.15 }), fx('bloom', { threshold: 0.5, intensity: 0.8, radius: 40 }), fx('chroma', { amount: 0.006 }), fx('film', { grain: 0.35, vignette: 0.45, halation: 0.1, lift: 0.04, weave: 0 })], ['camera', 'flash']);
add('Y2K', 'Frutiger Gloss', 'saturated aqua gloss with a sparkle', [fx('color', { saturation: 1.4, contrast: 1.06, hue: -8, brightness: 0.05 }), fx('bloom', { threshold: 0.5, intensity: 0.95, radius: 70 }), fx('glints', { threshold: 0.78, length: 100, intensity: 0.9, points: 2, rotation: 45, tint: '#bff0ff' })], ['aero', 'glossy']);
add('Y2K', 'Bubble Pop', 'candy colour, fat bloom, a whisper of holo', [fx('color', { saturation: 1.5, contrast: 1.1 }), fx('bloom', { threshold: 0.55, intensity: 0.8, radius: 70 }), fx('holo', { strength: 0.25, pastel: 0.6 }), fx('chroma', { amount: 0.01 })], ['candy', 'pastel']);
add('Y2K', 'Cyber Mall', 'cold magenta CRT with RGB bleed', [fx('crt', { scan: 0.4, bleed: 0.012, curve: 0.1 }), fx('chroma', { amount: 0.012 }), fx('color', { hue: 18, saturation: 1.3, contrast: 1.15 }), fx('bloom', { threshold: 0.55, intensity: 0.6, radius: 40 }), fx('grain', { amount: 0.15 })], ['crt', 'neon']);
add('Y2K', 'MSN Webcam', 'low-res webcam, crushed colour, noisy room', [fx('blur', { radius: 1.6 }), fx('pixel', { size: 3, mix: 0.45 }), fx('color', { saturation: 0.9, contrast: 1.2, brightness: 0.1 }), fx('grain', { amount: 0.45, size: 2 }), fx('vhs', { jitter: 0.08, bleed: 0.008, noise: 0.15, tracking: 0.05 })], ['webcam', 'lofi']);
add('Y2K', 'Holo Rave', 'rainbow foil, sparkle, hot bloom', [fx('holo', { strength: 1, scale: 2.4, shimmer: 0.35 }), fx('glints', { threshold: 0.75, length: 110, intensity: 1 }), fx('chroma', { amount: 0.008 }), fx('bloom', { threshold: 0.6, intensity: 0.6, radius: 50 })], ['holo', 'rave']);
add('Y2K', 'Silver Surfer', 'monochrome silver, sharp sparkle', [fx('gradmap', { shadow: '#0a0a0f', mid: '#8e96a8', high: '#ffffff', contrast: 1.3 }), fx('glints', { threshold: 0.7, length: 160, intensity: 1.2 }), fx('film', { grain: 0.2, vignette: 0.3, weave: 0, lift: 0.02 })], ['silver', 'bw']);
add('Y2K', 'Neon Chrome Pink', 'hot-pink liquid metal', [fx('gradmap', { shadow: '#12001f', mid: '#ff2fd2', high: '#fff0ff', contrast: 1.25 }), fx('bloom', { threshold: 0.55, intensity: 0.8, radius: 60 }), fx('chroma', { amount: 0.009 }), fx('grain', { amount: 0.12 })], ['pink', 'chrome']);
add('Y2K', 'Aero Blue', 'glass-blue gradient grade', [fx('gradmap', { shadow: '#001a3a', mid: '#3aa8ff', high: '#eafcff', contrast: 1.1 }), fx('bloom', { threshold: 0.6, intensity: 0.7, radius: 60 }), fx('glints', { threshold: 0.8, length: 90, intensity: 0.8, rotation: 30 })], ['aero', 'blue']);
add('Y2K', 'Laser Floor', 'three-ray lasers on every light', [fx('glints', { threshold: 0.6, length: 260, intensity: 1.6, points: 3, twinkle: 0.2, tint: '#9fd8ff' }), fx('bloom', { threshold: 0.6, intensity: 0.6, radius: 44 }), fx('chroma', { amount: 0.008 }), fx('color', { contrast: 1.2, saturation: 1.2 })], ['club', 'lasers']);
add('Y2K', 'Cyber Grid Night', 'neon floor under a night sky of your footage', [fx('grid3d', { sky: 0, floor: 0.4, speed: 0.5, color: '#7dffb0', color2: '#38e1ff' }), fx('bloom', { threshold: 0.65, intensity: 0.5, radius: 40 }), fx('crt', { scan: 0.2, bleed: 0.006, curve: 0.06 })], ['grid', 'synthwave']);
add('Y2K', 'Pixel Pager', 'chunky pixels with a handheld palette', [fx('pixel', { size: 8, mix: 1 }), fx('dither', { palette: 1, levels: 4, size: 2 }), fx('crt', { scan: 0.1, bleed: 0, curve: 0.03 })], ['pixel', 'handheld']);
add('Y2K', 'Date Stamp Dad-cam', 'timecode corner brackets and soft tape', [fx('vhs', { jitter: 0.12, bleed: 0.01, noise: 0.2, tracking: 0.1 }), fx('color', { saturation: 1.15, contrast: 1.08 }), fx('hud', { style: 2, grid: 0, timecode: 1, rec: 0 })], ['dv', 'home-video']);

// ---- Street ---------------------------------------------------------------------------------------------------------
add('Street', 'Bootleg Flyer', 'high-contrast photocopy on cream paper', [fx('color', { saturation: 0, contrast: 1.5, brightness: 0.04 }), fx('threshold', { level: 0.5, soft: 0.2, noise: 0.7, ink: '#1a1a1a', paper: '#f1e8cf' }), fx('halftone', { size: 6, mix: 0.25 }), fx('grain', { amount: 0.3, color: 0 })], ['xerox', 'paper']);
add('Street', 'Newsprint', 'greyscale newspaper halftone', [fx('color', { saturation: 0, contrast: 1.3 }), fx('halftone', { size: 7, angle: 45, contrast: 1.6, mix: 1 }), fx('grain', { amount: 0.3, size: 2, color: 0 }), fx('film', { grain: 0.1, vignette: 0.2, weave: 0, lift: 0.08 })], ['print', 'bw']);
add('Street', 'Riot Zine', 'red ink poster', [fx('threshold', { level: 0.46, soft: 0.15, noise: 0.9, ink: '#d8140f', paper: '#f4efe2' }), fx('grain', { amount: 0.35, color: 0 }), fx('shake', { amount: 0.004, zoom: 1.04, speed: 3 })], ['red', 'zine']);
add('Street', 'Wheatpaste', 'weathered poster on a wall', [fx('color', { contrast: 1.3, saturation: 0.7 }), fx('noise', { amount: 0.3, scale: 6, speed: 0.05, green: 0 }), fx('distort', { amount: 0.006, freq: 5, speed: 0.2 }), fx('grain', { amount: 0.4, size: 1.8 }), fx('film', { vignette: 0.4, lift: 0.1, grain: 0.1, weave: 0 })], ['poster', 'worn']);
add('Street', 'Skate Tape', 'handycam shake with tape wear', [fx('vhs', { jitter: 0.25, bleed: 0.013, noise: 0.3, tracking: 0.2 }), fx('shake', { amount: 0.008, speed: 5, zoom: 1.08, roll: 0.6 }), fx('color', { saturation: 1.25, contrast: 1.15 }), fx('chroma', { amount: 0.006 })], ['skate', 'vhs']);
add('Street', 'Comic Pop', 'red/yellow comic print with dots', [fx('gradmap', { shadow: '#1a0000', mid: '#d8140f', high: '#ffe11a', contrast: 1.4 }), fx('halftone', { size: 8, contrast: 1.5, mix: 0.5 }), fx('outline', { width: 2, ink: '#000000' }), fx('grain', { amount: 0.25 })], ['comic', 'pop']);
add('Street', 'Graffiti Flash', 'colour strobes on the hits', [fx('flash', { amount: 0.5, rate: 4, decay: 6, hue: 0.9, white: 0.4 }), fx('color', { saturation: 1.3, contrast: 1.2 }), fx('chroma', { amount: 0.01 })], ['flash']);
add('Street', 'Sticker Bomb', 'die-cut sticker with a white border', [fx('mask', { shape: 3, size: 0.4, wobble: 0.3 }), fx('outline', { width: 18, ink: '#ffffff' }), fx('color', { saturation: 1.25, contrast: 1.1 })], ['sticker']);
add('Street', 'Polaroid Burn', 'faded instant film with a warm burn', [fx('gradmap', { shadow: '#1a0c08', mid: '#a05a3a', high: '#ffe9c9', contrast: 1.05, mix: 0.45 }), fx('film', { grain: 0.4, halation: 0.35, lift: 0.12, vignette: 0.5, weave: 0 }), fx('bloom', { threshold: 0.7, intensity: 0.4, radius: 36 })], ['instant', 'warm']);
add('Street', 'Street Strobe', 'beat-locked flash and punch', [fx('shake', { amount: 0.004, zoom: 1.06 }, bind('amount', 'beat', 0.5)), fx('flash', { amount: 0, white: 0.8 }, bind('amount', 'beat', 0.4)), fx('chroma', { amount: 0.004 }, bind('amount', 'beat', 0.5))], ['beat', 'strobe']);
add('Street', 'Concrete', 'drained city grey', [fx('color', { saturation: 0.35, contrast: 1.35, brightness: -0.03 }), fx('grain', { amount: 0.3, size: 1.6 }), fx('film', { vignette: 0.45, grain: 0.1, lift: 0.06, weave: 0 })], ['grey', 'grit']);
add('Street', 'Night Photocopy', 'blown-out black-and-white copy', [fx('color', { saturation: 0, contrast: 2, levels: 4 }), fx('grain', { amount: 0.5, size: 2.2, color: 0 }), fx('halftone', { size: 5, mix: 0.2 })], ['xerox']);

// ---- Cinematic ------------------------------------------------------------------------------------------------------
add('Cinematic', 'Teal & Orange Night', 'cool shadows, warm lights', [fx('gradmap', { shadow: '#0b2a3a', mid: '#6a7a7a', high: '#ffb070', contrast: 1.1, mix: 0.4 }), fx('color', { contrast: 1.15, saturation: 1.1 }), fx('film', { grain: 0.25, halation: 0.3, vignette: 0.35, weave: 0 })], ['teal', 'orange']);
add('Cinematic', 'Neo-Noir', 'near-monochrome, hard shadows', [fx('color', { saturation: 0.2, contrast: 1.45, brightness: -0.04 }), fx('gradmap', { shadow: '#000000', mid: '#5a5f66', high: '#e9ecef', mix: 0.3 }), fx('film', { grain: 0.35, vignette: 0.6, halation: 0.2, weave: 0.1 })], ['noir', 'bw']);
add('Cinematic', 'Anamorphic Blue Streak', 'long horizontal blue flares', [fx('glints', { threshold: 0.62, length: 420, intensity: 1.5, points: 1, rotation: 0, twinkle: 0.1, tint: '#5f9bff' }), fx('bloom', { threshold: 0.6, intensity: 0.5, radius: 44 }), fx('film', { grain: 0.2, vignette: 0.3, weave: 0 })], ['anamorphic', 'flare']);
add('Cinematic', 'Bleach Bypass', 'silvery, gritty, high contrast', [fx('color', { saturation: 0.5, contrast: 1.5 }), fx('film', { grain: 0.5, contrast: 0.6, halation: 0.15, vignette: 0.35, weave: 0 })], ['gritty']);
add('Cinematic', 'Golden Hour', 'warm glow and soft bloom', [fx('gradmap', { shadow: '#2a1205', mid: '#d08a3c', high: '#fff2d2', mix: 0.3 }), fx('bloom', { threshold: 0.6, intensity: 0.6, radius: 60 }), fx('film', { grain: 0.2, halation: 0.35, vignette: 0.3, weave: 0 })], ['warm', 'sunset']);
add('Cinematic', 'Moonlight', 'blue night wash', [fx('gradmap', { shadow: '#02060f', mid: '#2f4a7a', high: '#cfe0ff', mix: 0.5 }), fx('film', { grain: 0.3, vignette: 0.5, lift: 0.04, weave: 0 }), fx('bloom', { threshold: 0.7, intensity: 0.4, radius: 50 })], ['night', 'blue']);
add('Cinematic', '16mm Doc', 'handheld documentary grain', [fx('film', { grain: 0.6, halation: 0.2, weave: 0.5, vignette: 0.3, lift: 0.08 }), fx('color', { saturation: 0.85, contrast: 1.1 }), fx('shake', { amount: 0.003, speed: 3, zoom: 1.04, roll: 0.3 })], ['16mm', 'documentary']);
add('Cinematic', 'Super 8 Memory', 'warm, jittery home movie', [fx('film', { grain: 0.7, halation: 0.4, weave: 0.8, vignette: 0.5, lift: 0.14 }), fx('gradmap', { shadow: '#1f0f06', mid: '#b3753d', high: '#ffe8bd', mix: 0.35 }), fx('blur', { radius: 1.2 })], ['super8', 'nostalgia']);
add('Cinematic', 'Silent Era', 'flickering black and white', [fx('color', { saturation: 0, contrast: 1.3 }), fx('film', { grain: 0.55, weave: 0.9, vignette: 0.6, lift: 0.12, halation: 0.1 }), fx('flash', { amount: 0.08, rate: 14, decay: 12, white: 1 })], ['bw', 'vintage']);
add('Cinematic', 'Dreamy Fade', 'lifted blacks, soft glow', [fx('film', { lift: 0.16, grain: 0.2, halation: 0.4, vignette: 0.2, weave: 0 }), fx('blur', { radius: 4, mix: 0.4 }), fx('bloom', { threshold: 0.55, intensity: 0.7, radius: 70 })], ['soft', 'faded']);
add('Cinematic', 'Scope 2.39', 'letterbox with film finish', [fx('crop', { top: 0.12, bottom: 0.12 }), fx('film', { grain: 0.25, halation: 0.25, vignette: 0.3, weave: 0 })], ['letterbox']);
add('Cinematic', 'Heat Haze', 'shimmering desert warmth', [fx('distort', { amount: 0.006, freq: 14, speed: 1.6, angle: 90 }), fx('gradmap', { shadow: '#210d03', mid: '#c97b2e', high: '#fff0c2', mix: 0.3 }), fx('bloom', { threshold: 0.6, intensity: 0.5, radius: 50 })], ['hot', 'mirage']);

// ---- Glitch ---------------------------------------------------------------------------------------------------------
add('Glitch', 'Datamosh Smear', 'blocks smear instead of cutting', [fx('mosh', { amount: 0.6, block: 32, hold: 5, smear: 1.8 }), fx('chroma', { amount: 0.015 }), fx('grain', { amount: 0.2 })], ['mosh']);
add('Glitch', 'Signal Loss', 'tearing bands and colour split', [fx('glitch', { amount: 0.5, split: 0.02, rate: 10 }), fx('slices', { bands: 14, shift: 0.1, black: 0.15, rate: 6 }), fx('chroma', { amount: 0.015 })], ['broken']);
add('Glitch', 'RGB Torn', 'sliced channels', [fx('slices', { bands: 24, shift: 0.12, black: 0.1, rate: 9, split: 0.03 }), fx('chroma', { amount: 0.02, radial: 0 }), fx('color', { contrast: 1.2 })], ['rgb']);
add('Glitch', 'Pixel Storm', 'pixel blocks and bursts', [fx('pixel', { size: 14, mix: 0.7 }), fx('glitch', { amount: 0.55, blocks: 0.1, rate: 14 }), fx('color', { contrast: 1.3, levels: 8 })], ['pixel']);
add('Glitch', 'Error 404', 'harsh threshold with code-like noise', [fx('threshold', { level: 0.5, soft: 0.05, noise: 1.2, ink: '#07130a', paper: '#7dffb0' }), fx('glitch', { amount: 0.4, rate: 8 }), fx('crt', { scan: 0.4, bleed: 0.004, curve: 0.04 })], ['terminal', 'error']);
add('Glitch', 'Block Party', 'chunky displacement', [fx('glitch', { amount: 0.7, blocks: 0.2, split: 0.03, rate: 12 }), fx('mosh', { amount: 0.3, block: 64, hold: 4, smear: 0.8 })], ['blocks']);
add('Glitch', 'Broken Screen', 'warped glass and dead lines', [fx('distort', { amount: 0.03, freq: 9, speed: 0.8 }), fx('slices', { bands: 8, shift: 0.05, black: 0.3, rate: 3 }), fx('crt', { scan: 0.5, curve: 0.18, bleed: 0.01 })], ['crt']);
add('Glitch', 'Static Bleed', 'noise creeping in', [fx('noise', { amount: 0.5, scale: 9, speed: 1.5, green: 0 }), fx('grain', { amount: 0.5, size: 2 }), fx('vhs', { jitter: 0.3, bleed: 0.015, noise: 0.6, tracking: 0.4 })], ['static']);
add('Glitch', 'Scanline Tear', 'thin horizontal tears', [fx('slices', { bands: 50, shift: 0.05, black: 0, rate: 12 }), fx('crt', { scan: 0.35, bleed: 0.008, curve: 0.05 }), fx('chroma', { amount: 0.008 })], ['tear']);
add('Glitch', 'Beat Glitch', 'glitch swells on the kick', [fx('glitch', { amount: 0.05, split: 0.005, rate: 16 }, bind('amount', 'beat', 0.8)), fx('chroma', { amount: 0.002 }, bind('amount', 'beat', 0.4))], ['beat', 'audio']);
add('Glitch', 'Corrupt Cam', 'targeting overlay on a dithered feed', [fx('dither', { palette: 4, levels: 4, size: 2 }), fx('glitch', { amount: 0.3, rate: 7 }), fx('hud', { style: 1, color: '#7dffb0', grid: 0.1 })], ['hud', 'surveillance']);
add('Glitch', 'Tape Eat', 'tracking collapses', [fx('vhs', { jitter: 0.6, bleed: 0.02, noise: 0.5, tracking: 1 }), fx('shake', { amount: 0.01, speed: 6, zoom: 1.06, roll: 1.4 }), fx('color', { saturation: 1.2, contrast: 1.1 })], ['vhs']);

// ---- Retro tape / lo-fi -----------------------------------------------------------------------------------------------
add('Retro', 'VHS Rental', 'worn rental tape', [fx('vhs', { jitter: 0.3, bleed: 0.013, noise: 0.4, tracking: 0.3 }), fx('color', { saturation: 1.15, contrast: 1.1, brightness: 0.02 }), fx('bloom', { threshold: 0.65, intensity: 0.35, radius: 30 })], ['vhs']);
add('Retro', 'Betamax Bleed', 'smeared chroma, soft detail', [fx('blur', { radius: 1.5 }), fx('vhs', { jitter: 0.1, bleed: 0.03, noise: 0.2, tracking: 0.1 }), fx('chroma', { amount: 0.008 }), fx('color', { saturation: 1.25 })], ['bleed']);
add('Retro', 'CRT Arcade', 'curved glass, bright scanlines', [fx('crt', { scan: 0.6, lines: 480, bleed: 0.012, curve: 0.18, vignette: 0.6 }), fx('bloom', { threshold: 0.5, intensity: 0.8, radius: 36 }), fx('color', { saturation: 1.3, contrast: 1.15 })], ['arcade']);
add('Retro', 'Handheld Green', '4-shade handheld screen', [fx('dither', { palette: 1, levels: 4, size: 3 }), fx('crt', { scan: 0.12, bleed: 0, curve: 0.04 })], ['gameboy']);
add('Retro', 'Amber Terminal', 'dithered amber monitor', [fx('dither', { palette: 2, levels: 5, size: 2 }), fx('crt', { scan: 0.35, bleed: 0.004, curve: 0.1 }), fx('bloom', { threshold: 0.5, intensity: 0.7, radius: 30 })], ['terminal']);
add('Retro', 'Fax Machine', 'grainy one-colour print', [fx('color', { saturation: 0, contrast: 1.5 }), fx('threshold', { level: 0.5, soft: 0.1, noise: 1.2, ink: '#161616', paper: '#ececec' }), fx('slices', { bands: 40, shift: 0.02, black: 0, rate: 3 })], ['fax']);
add('Retro', 'Teletext', 'blocky 4-colour broadcast', [fx('pixel', { size: 10, mix: 1 }), fx('color', { levels: 4, saturation: 1.6, contrast: 1.3 }), fx('crt', { scan: 0.3, bleed: 0.01, curve: 0.08 })], ['broadcast']);
add('Retro', 'Old TV News', 'tired evening bulletin', [fx('crt', { scan: 0.4, bleed: 0.01, curve: 0.12, vignette: 0.5 }), fx('color', { saturation: 0.75, contrast: 1.1 }), fx('grain', { amount: 0.3 }), fx('chroma', { amount: 0.005 })], ['news']);
add('Retro', 'Camcorder', 'REC badge, live timecode, tape wobble', [fx('vhs', { jitter: 0.18, bleed: 0.01, noise: 0.25, tracking: 0.15 }), fx('color', { saturation: 1.15, contrast: 1.08 }), fx('hud', { style: 0, grid: 0.12 })], ['rec', 'hud']);
add('Retro', 'Security Cam', 'target lock on a grainy feed', [fx('color', { saturation: 0.2, contrast: 1.2 }), fx('grain', { amount: 0.45, size: 2 }), fx('crt', { scan: 0.25, curve: 0.05, bleed: 0.005 }), fx('hud', { style: 1, color: '#ffffff', grid: 0 })], ['surveillance']);

// ---- Dream ----------------------------------------------------------------------------------------------------------
add('Dream', 'Pastel Fog', 'milky pastel haze', [fx('blur', { radius: 10, mix: 0.6 }), fx('color', { saturation: 0.85, brightness: 0.06, contrast: 0.95 }), fx('noise', { amount: 0.25, scale: 3, speed: 0.15, green: 0 }), fx('bloom', { threshold: 0.5, intensity: 0.7, radius: 80 })], ['soft', 'pastel']);
add('Dream', 'Soft Focus Glow', 'portrait glow', [fx('blur', { radius: 6, mix: 0.5 }), fx('bloom', { threshold: 0.45, intensity: 0.8, radius: 60 }), fx('film', { lift: 0.08, grain: 0.15, vignette: 0.25, weave: 0, halation: 0.3 })], ['glow']);
add('Dream', 'Hypnagogic', 'half-asleep wobble', [fx('fluid', { amount: 0.05, scale: 2.2, speed: 0.25 }), fx('chroma', { amount: 0.012 }), fx('bloom', { threshold: 0.55, intensity: 0.7, radius: 60 })], ['trippy']);
add('Dream', 'Liquid Memory', 'melting edges', [fx('fluid', { amount: 0.12, scale: 1.6, speed: 0.3 }), fx('distort', { amount: 0.01, freq: 6, speed: 0.6 }), fx('color', { saturation: 1.2 })], ['liquid']);
add('Dream', 'Lucid Kaleido', 'slow mirror bloom', [fx('kaleido', { segments: 8, spin: 5, zoom: 1.2, mix: 0.55 }), fx('bloom', { threshold: 0.55, intensity: 0.7, radius: 60 }), fx('chroma', { amount: 0.008 })], ['kaleidoscope']);
add('Dream', 'Opal Shimmer', 'iridescent veil', [fx('holo', { strength: 0.5, pastel: 0.7, shimmer: 0.2 }), fx('blur', { radius: 3, mix: 0.4 }), fx('bloom', { threshold: 0.6, intensity: 0.5, radius: 60 })], ['iridescent']);
add('Dream', 'Heat Mirage', 'wavering air', [fx('distort', { amount: 0.008, freq: 18, speed: 2, angle: 90 }), fx('blur', { radius: 2, mix: 0.5 }), fx('color', { saturation: 1.1, brightness: 0.03 })], ['haze']);
add('Dream', 'Cloud Noise', 'drifting cloud texture on the picture', [fx('noise', { amount: 0.5, scale: 3.5, speed: 0.2, green: 0.1 }), fx('bloom', { threshold: 0.6, intensity: 0.6, radius: 60 }), fx('color', { saturation: 1.1 })], ['clouds']);

// ---- 3D ---------------------------------------------------------------------------------------------------------------
add('3D', 'Mirror Ball', 'a chrome sphere that catches the room', [fx('object3d', { shape: 1, material: 1, background: 0, size: 1.5, sy: 25, tint: '#eaf0ff', shine: 1.2 }), fx('glints', { threshold: 0.85, length: 120, intensity: 0.8 })], ['sphere', 'chrome']);
add('3D', 'Neon Torus', 'wireframe ring on a dark picture', [fx('object3d', { shape: 2, material: 3, background: 1, size: 1.5, rx: 60, sy: 30, sx: 14, tint: '#ff4fd8' }), fx('bloom', { threshold: 0.55, intensity: 0.8, radius: 36 })], ['torus', 'wireframe']);
add('3D', 'Crystal', 'a glass octahedron bending the footage', [fx('object3d', { shape: 5, material: 2, background: 0, size: 1.5, sy: 22, sx: 8 }), fx('chroma', { amount: 0.005 })], ['glass']);
add('3D', 'Footage Sphere', 'your picture wrapped on a globe', [fx('object3d', { shape: 1, material: 0, background: 1, size: 1.35, sy: 18, rx: 10 })], ['sphere', 'wrap']);
add('3D', 'Footage Ring', 'the frame bent into a turning ring', [fx('object3d', { shape: 2, material: 0, background: 1, size: 1.5, rx: 50, sy: 20 })], ['torus', 'wrap']);
add('3D', 'Wire Sphere', 'neon globe lines', [fx('object3d', { shape: 1, material: 3, background: 1, size: 1.4, sy: 30, tint: '#6dffd0' }), fx('bloom', { threshold: 0.6, intensity: 0.7, radius: 30 })], ['sphere', 'wireframe']);
add('3D', 'Cube on the Grid', 'chrome cube over a synthwave floor', [fx('grid3d', { sky: 1, speed: 0.5 }), fx('object3d', { shape: 3, material: 1, background: 0, size: 0.9, y: -0.05, sy: 40, tint: '#ffd6f6' }), fx('bloom', { threshold: 0.6, intensity: 0.5, radius: 40 })], ['cube', 'synthwave']);
add('3D', 'Holo Cube', 'iridescent rounded cube', [fx('object3d', { shape: 3, material: 4, background: 1, size: 1.2, sy: 35, sx: 10 }), fx('glints', { threshold: 0.8, length: 100, intensity: 0.8 })], ['cube', 'holo']);
add('3D', 'Tumbling Capsule', 'glass pill rolling through frame', [fx('object3d', { shape: 4, material: 2, background: 0, size: 1.4, rz: 25, sy: 30, sx: 40 })], ['pill']);

// ---- Beat (audio-reactive) ------------------------------------------------------------------------------------------
add('Beat', 'Beat Zoom', 'camera punch on every kick', [fx('shake', { amount: 0.002, zoom: 1.02 }, { ...bind('amount', 'beat', 0.5), ...bind('zoom', 'beat', 0.25) })], ['beat', 'punch']);
add('Beat', 'Bass Flash', 'white flash that follows the low end', [fx('flash', { amount: 0, white: 0.9 }, bind('amount', 'bass', 0.6)), fx('chroma', { amount: 0.003 }, bind('amount', 'bass', 0.5))], ['bass']);
add('Beat', 'Kick Chroma', 'colour split spikes', [fx('chroma', { amount: 0.002 }, bind('amount', 'beat', 0.9)), fx('bloom', { threshold: 0.65, intensity: 0.3 }, bind('intensity', 'beat', 0.7))], ['beat']);
add('Beat', 'Beat Glow', 'bloom breathes with the level', [fx('bloom', { threshold: 0.5, intensity: 0.3, radius: 60 }, bind('intensity', 'rms', 1.2)), fx('color', { saturation: 1.1 })], ['rms', 'glow']);
add('Beat', 'Hi-hat Glints', 'sparkle on the highs', [fx('glints', { threshold: 0.65, length: 120, intensity: 0.2 }, bind('intensity', 'high', 1.8)), fx('bloom', { threshold: 0.7, intensity: 0.4 })], ['high', 'sparkle']);
add('Beat', 'Pulse Veins', 'veins flare on the beat', [fx('veins', { mode: 0, origin: 5, growth: 1, density: 2.6, thickness: 0.13, glow: 0.4, color: '#7dffb0', seed: 9 }, { ...bind('glow', 'beat', 0.7), ...bind('thickness', 'beat', 0.12) })], ['organic', 'beat']);
add('Beat', 'Spin Kaleido', 'mirror zoom rides the bass', [fx('kaleido', { segments: 6, spin: 10, zoom: 1, mix: 0.7 }, bind('zoom', 'bass', 0.5)), fx('chroma', { amount: 0.006 })], ['kaleidoscope', 'bass']);
add('Beat', 'Bass Warp', 'the picture bulges on every low note', [fx('distort', { amount: 0.004, freq: 5, speed: 1.4 }, bind('amount', 'bass', 0.12)), fx('chroma', { amount: 0.004 }, bind('amount', 'bass', 0.3))], ['bass', 'warp']);
add('Beat', 'Strobe Mosh', 'mosh amount tied to the kick', [fx('mosh', { amount: 0.1, block: 40, hold: 6, smear: 1 }, bind('amount', 'beat', 0.8)), fx('flash', { amount: 0, white: 0.5 }, bind('amount', 'beat', 0.3))], ['beat', 'mosh']);

// ---- Clean ----------------------------------------------------------------------------------------------------------
add('Clean', 'Punch Clean', 'light grade, a little grain', [fx('color', { contrast: 1.08, saturation: 1.12 }), fx('film', { grain: 0.14, halation: 0.12, vignette: 0.15, lift: 0.02, weave: 0 })], ['tiktok', 'natural']);
add('Clean', 'Social Pop', 'bright, saturated, phone-screen ready', [fx('color', { saturation: 1.25, contrast: 1.12, brightness: 0.03 }), fx('bloom', { threshold: 0.8, intensity: 0.25, radius: 30 })], ['tiktok', 'bright']);
add('Clean', 'Crisp Night', 'lifted exposure, clean highlights', [fx('color', { contrast: 1.2, brightness: 0.05, saturation: 1.1 }), fx('bloom', { threshold: 0.75, intensity: 0.35, radius: 40 })], ['night']);
add('Clean', 'Matte Fade', 'flat matte look', [fx('film', { lift: 0.14, contrast: 0.3, grain: 0.1, vignette: 0.1, weave: 0, halation: 0.05 }), fx('color', { saturation: 0.9 })], ['matte']);
add('Clean', 'Vivid Travel', 'rich colour, deep contrast', [fx('color', { saturation: 1.4, contrast: 1.2, brightness: 0.02 }), fx('film', { vignette: 0.2, grain: 0.08, weave: 0 })], ['travel']);
add('Clean', 'Black & White', 'classic contrasty monochrome', [fx('color', { saturation: 0, contrast: 1.3 }), fx('film', { grain: 0.25, vignette: 0.3, weave: 0 })], ['bw']);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const INHERITED = [
  ...ADJUST_LOOKS.map((l) => ({ ...l, category: l.name.startsWith('3D') || l.name.includes('Grid') ? '3D' : 'Y2K', tags: ['layer'] })),
  ...ORGANIC_LOOKS.map((l) => ({ ...l, category: 'Organic', tags: ['organic', 'grows'] })),
  ...EFFECT_PRESETS.map((p) => ({ name: p.name, note: 'effect chain', chain: p.chain, category: 'Effects', tags: ['classic'] })),
];

/** Every preset, de-duplicated by id (a name used twice keeps the first). */
export const PRESET_LIBRARY = (() => {
  const seen = new Set(), out = [];
  for (const p of [...NEW, ...INHERITED]) {
    const id = `${slug(p.category)}/${slug(p.name)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: p.name, category: p.category, note: p.note || '', tags: p.tags || [], chain: p.chain });
  }
  return out;
})();

export const PRESET_CATEGORIES = ['Y2K', 'Street', 'Cinematic', 'Glitch', 'Retro', 'Dream', 'Organic', '3D', 'Beat', 'Clean', 'Effects'];

/** Case-insensitive search over name, note, category and tags; every word must match somewhere. */
export function searchPresets(query = '', category = 'All') {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return PRESET_LIBRARY.filter((p) => (category === 'All' || p.category === category)
    && words.every((w) => `${p.name} ${p.note} ${p.category} ${p.tags.join(' ')}`.toLowerCase().includes(w)));
}
