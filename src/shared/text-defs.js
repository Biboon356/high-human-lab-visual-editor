// Typography Lab definitions: default style, animations, and experimental presets.
import { createClip, defaultProps } from './project.js';
import { createEffect } from './effects-defs.js';

export const FONTS = [
  'DotGothic16', 'Zen Antique', 'Dela Gothic One', 'Rozha One', 'Yatra One', 'Modak', 'Tiro Devanagari Hindi', 'Eczar', 'Teko', 'Khand', 'Kalam', 'Amita', 'Martel', 'Anton', 'Permanent Marker', 'Special Elite', 'Rubik Spray Paint', 'Black Ops One', 'Rubik Glitch', 'Archivo Black', 'Rock Salt', 'Bungee', 'Bebas Neue', 'Michroma', 'Orbitron', 'Press Start 2P', 'UnifrakturCook', 'Pirata One', 'Pinyon Script', 'Instrument Serif', 'Inter Tight', 'DM Mono', 'Helvetica Neue', 'Arial Black', 'Impact', 'Futura', 'Courier New', 'Menlo', 'Consolas',
  'Georgia', 'Times New Roman', 'Didot', 'Bodoni 72', 'Baskerville', 'Playfair Display', 'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', 'sans-serif', 'serif', 'monospace',
];

export const TEXT_ANIMATIONS = {
  none: 'None',
  typewriter: 'Typewriter',
  fade: 'Fade in / out',
  slide: 'Slide up',
  flicker: 'Flicker',
  jitter: 'Glitch jitter',
  pulse: 'Pulse',
  ticker: 'Ticker scroll',
  slam: 'Slam in (overshoot)',
  stutter: 'Stutter cut-in',
  strobe: 'Strobe',
  letters: 'Letters rise (stagger)',
  wave: 'Wave (per letter)',
  scramble: 'Decode / scramble',
  karaoke: 'Karaoke (word highlight)',
};

export function defaultText() {
  return {
    content: 'HIGH HUMAN LAB',
    font: 'Helvetica Neue',
    weight: 700,
    italic: false,
    size: 0.1, // fraction of frame height
    align: 'center',
    lineHeight: 1.1,
    color: '#ffffff',
    fit: 0, // 0 = use size; >0 = fit widest line to this fraction of frame width
    hollow: false, // outline only; fillAlpha keeps a faint fill
    fillAlpha: 1,
    strokeWidth: 0, // fraction of font size
    strokeColor: '#2f7d4f',
    uppercase: false,
    bg: { enabled: false, color: '#1c4d33', pad: 0.25 },
    anim: { type: 'none', duration: 1, speed: 1 },
    // premium finish: 0..1 strengths (split = RGB fringe, shadow/glow = depth), optional vertical gradient fill
    fx: { split: 0, shadow: 0, glow: 0, halo: 0, gradient: false, grad1: '#ffffff', grad2: '#7d8f85', gradStops: null },
    vertical: false, colSpacing: 1.35, // tategaki (upright columns, right to left) for Japanese
    outline2: null, // { width, color }: a second, wider rim outside the outline (sticker / bubble chrome)
  };
}

const mk = (name, text, props, effects = []) => ({ name, text, props, effects });

export const TEXT_PRESETS = [
  // Formal script lockup: a small serif kicker over a hot-pink script title (the "Moore Next Door" look). Add both with "Title lockup".
  mk('Script Title (rose)',
    { content: 'Moore Next Door', font: 'Pinyon Script', weight: 400, size: 0.14, fit: 0.92, color: '#f2287d', strokeWidth: 0.03, strokeColor: '#7d0b44',
      anim: { type: 'fade', duration: 0.6, speed: 1 }, fx: { shadow: 0.55, glow: 0.3, split: 0.08 } },
    { y: 0.02 }),
  mk('Script Kicker (small caps)',
    { content: 'IN', font: 'Instrument Serif', weight: 400, size: 0.06, uppercase: true, color: '#ff3a6e',
      anim: { type: 'fade', duration: 0.5, speed: 1 }, fx: { shadow: 0.4 } },
    { x: 0.03, y: 0.15, tracking: 0.18 }),
  // readable over busy pictures: a dark halo cloud behind clean white capitals
  mk('Brand Title (halo)',
    { content: 'HIGH HUMAN LAB', font: 'Instrument Serif', weight: 400, size: 0.085, fit: 0.9, uppercase: true, color: '#ffffff', strokeWidth: 0,
      anim: { type: 'fade', duration: 0.8, speed: 1 }, fx: { halo: 0.9, shadow: 0.25, glow: 0.15 } },
    { tracking: 0.28 }),
  mk('Brand Sub (halo)',
    { content: 'visual editor', font: 'Michroma', weight: 400, size: 0.04, uppercase: true, color: '#dfe9ff', strokeWidth: 0,
      anim: { type: 'fade', duration: 1.1, speed: 1 }, fx: { halo: 0.8, shadow: 0.2 } },
    { y: -0.12, tracking: 0.4 }),
  // ---- niche pack: Japanese, Y2K chrome, techno, pixel, blackletter, digicam ----
  mk('Cyber Katakana (pixel)',
    { content: 'サイバー・シティ', font: 'DotGothic16', weight: 400, size: 0.11, fit: 0.86, color: '#a8ffe0', strokeWidth: 0, anim: { type: 'typewriter', duration: 1.4, speed: 1 }, fx: { glow: 0.85, split: 0.35, shadow: 0.2 } },
    { tracking: 0.08 }, [createEffect('crt', { scan: 0.3, curve: 0.03 })]),
  mk('Tokyo Vertical (mincho)',
    { content: '東京\n夜行', font: 'Zen Antique', weight: 400, size: 0.085, vertical: true, colSpacing: 1.5, lineHeight: 1.12, color: '#f4efe3', anim: { type: 'fade', duration: 1.2, speed: 1 }, fx: { shadow: 0.55, glow: 0.12 } },
    { x: 0.32 }),
  mk('Y2K Chrome Bubble',
    { content: 'FUTURE\nPROOF', font: 'Dela Gothic One', weight: 400, size: 0.16, fit: 0.84, uppercase: true, lineHeight: 0.98, color: '#dfe9ff', strokeWidth: 0.02, strokeColor: '#16226b',
      outline2: { width: 0.05, color: '#f2f6ff' }, anim: { type: 'slam', duration: 0.6, speed: 1 },
      fx: { gradient: true, gradStops: [[0, '#ffffff'], [0.4, '#92b8ff'], [0.5, '#1c2e80'], [0.53, '#d6e6ff'], [0.78, '#6f93e6'], [1, '#ffffff']], shadow: 0.9, glow: 0.45 } },
    { tracking: -0.02 }, [createEffect('bloom', { intensity: 0.45, threshold: 0.55 })]),
  mk('Techno Spec Sheet',
    { content: 'SYS//ORGANIC  v2.00\nSIGNAL 98.6 — LAT 35.68N', font: 'Michroma', weight: 400, size: 0.03, align: 'left', uppercase: true, color: '#f2f2ee', lineHeight: 1.7,
      anim: { type: 'typewriter', duration: 1.8, speed: 1 }, fx: { shadow: 0.3 } },
    { x: -0.2, y: 0.4, tracking: 0.14 }),
  mk('Pixel Dialog',
    { content: 'PRESS START', font: 'Press Start 2P', weight: 400, size: 0.045, color: '#ffffff', bg: { enabled: true, color: '#0d0d2b', pad: 0.9 }, strokeWidth: 0, anim: { type: 'strobe', duration: 1, speed: 0.5 }, fx: { shadow: 0 } },
    { y: -0.3 }),
  mk('Gothic Drop (blackletter)',
    { content: 'Night Garden', font: 'UnifrakturCook', weight: 700, size: 0.17, fit: 0.84, color: '#f6f1e7', strokeWidth: 0, anim: { type: 'fade', duration: 1.1, speed: 1 }, fx: { shadow: 0.7, glow: 0.35 } },
    { tracking: 0.01 }, [createEffect('film', { grain: 0.3, halation: 0.45 })]),
  mk('Pirata Poster',
    { content: 'NO REST\nFOR THE WICKED', font: 'Pirata One', weight: 400, size: 0.13, fit: 0.88, uppercase: true, lineHeight: 0.92, color: '#ffffff', strokeWidth: 0, anim: { type: 'stutter', duration: 0.7, speed: 1 }, fx: { split: 0.4, shadow: 0.5 } },
    { tracking: 0.02 }),
  mk('Orbitron Loading (Y2K)',
    { content: 'LOADING... 99%', font: 'Orbitron', weight: 900, size: 0.05, uppercase: true, color: '#8fd3ff', strokeWidth: 0, anim: { type: 'flicker', duration: 1, speed: 0.6 }, fx: { glow: 0.9, split: 0.25 } },
    { tracking: 0.4, y: -0.34 }),
  mk('Digicam Date Stamp',
    { content: '\u201902 10 27   18:46', font: 'Orbitron', weight: 500, size: 0.034, align: 'right', color: '#ff9a1f', anim: { type: 'none', duration: 1, speed: 1 }, fx: { glow: 0.35, shadow: 0.35 } },
    { x: 0.24, y: -0.4, tracking: 0.1 }),
  mk('REC Overlay',
    { content: '\u25CF REC  00:00:12', font: 'Orbitron', weight: 500, size: 0.035, align: 'left', color: '#ff3b3b', anim: { type: 'strobe', duration: 1, speed: 0.35 }, fx: { glow: 0.4 } },
    { x: -0.3, y: 0.4, tracking: 0.12 }),
  mk('Hollow Glitch Block',
    { content: 'ROCKY', font: 'Arial Black', weight: 900, size: 0.3, fit: 0.92, uppercase: true, color: '#ffffff', hollow: true, fillAlpha: 0.12, strokeWidth: 0.012, strokeColor: '#ffffff',
      anim: { type: 'stutter', duration: 0.6, speed: 1 }, fx: { split: 0.55 } },
    { tracking: -0.01, blend: 'exclusion' }, [createEffect('slices', { bands: 10, shift: 0.022, black: 0.0, rate: 5, split: 0.006 }), createEffect('chroma', { amount: 0.006 })]),
  mk('Letters Rise',
    { content: 'EVERYTHING GROWS', font: 'Helvetica Neue', weight: 900, size: 0.1, fit: 0.9, uppercase: true, color: '#ffffff',
      anim: { type: 'letters', duration: 1.2, speed: 1 }, fx: { shadow: 0.5, glow: 0.3 } },
    { tracking: 0.02 }),
  mk('Decode',
    { content: 'SIGNAL FOUND', font: 'Courier New', weight: 700, size: 0.07, fit: 0.8, uppercase: true, color: '#7dff9f',
      anim: { type: 'scramble', duration: 1.4, speed: 1 }, fx: { glow: 0.6, split: 0.2 } },
    { tracking: 0.05 }, [createEffect('crt', { scan: 0.35, curve: 0.04 })]),
  mk('Chrome Slam',
    { content: 'HIGH HUMAN', font: 'Arial Black', weight: 900, size: 0.24, fit: 0.9, uppercase: true, color: '#ffffff', lineHeight: 0.95,
      anim: { type: 'slam', duration: 0.55, speed: 1 }, fx: { split: 0.5, shadow: 0.8, glow: 0.2, gradient: true, grad1: '#ffffff', grad2: '#6f8379' } },
    { tracking: -0.03 }, [createEffect('film', { grain: 0.3, halation: 0.35 })]),
  mk('Editorial Didot',
    { content: 'Organic\nStructures', font: 'Didot', weight: 400, italic: true, size: 0.17, fit: 0.8, color: '#f4fff8', lineHeight: 0.9,
      anim: { type: 'fade', duration: 1.4, speed: 1 }, fx: { shadow: 0.6, glow: 0.35, split: 0.12 } },
    { tracking: -0.015 }, [createEffect('film', { grain: 0.35, halation: 0.5 })]),
  mk('Stutter Stack',
    { content: 'NO SIGNAL\nNO SIGNAL\nNO SIGNAL', font: 'Impact', weight: 400, size: 0.16, fit: 0.8, uppercase: true, color: '#ffffff', lineHeight: 0.88,
      anim: { type: 'stutter', duration: 0.9, speed: 1 }, fx: { split: 0.7, shadow: 0.5 } },
    { tracking: 0.01 }, [createEffect('glitch', { amount: 0.3, rate: 10 }), createEffect('chroma', { amount: 0.012 })]),
  mk('Strobe Caption',
    { content: 'LIVE FROM THE ROOTS', font: 'Helvetica Neue', weight: 900, size: 0.07, uppercase: true, color: '#7dff9f',
      anim: { type: 'strobe', duration: 1, speed: 1 }, fx: { glow: 0.9, split: 0.3 } },
    { tracking: 0.3, y: -0.3 }, [createEffect('bloom', { intensity: 0.6, threshold: 0.35 })]),
  mk('Broadcast Lower Third',
    { content: 'LIVE — HIGH HUMAN LAB', font: 'Menlo', weight: 700, size: 0.05, align: 'left', uppercase: true, color: '#ffffff',
      bg: { enabled: true, color: '#1c4d33', pad: 0.45 }, anim: { type: 'slide', duration: 0.6, speed: 1 } },
    { x: -0.3, y: -0.36, tracking: 0.08 }),
  mk('Teletext Page',
    { content: 'P100  ROOT SIGNAL\nCH 04 · NO CARRIER', font: 'Courier New', weight: 700, size: 0.06, align: 'left', color: '#7dff9f',
      bg: { enabled: true, color: '#000000', pad: 0.5 }, anim: { type: 'typewriter', duration: 2.5, speed: 1 } },
    { x: -0.32, y: 0.28, tracking: 0.04 }),
  mk('Glitch Title',
    { content: 'SIGNAL ROT', font: 'Arial Black', weight: 900, size: 0.2, fit: 0.9, uppercase: true, color: '#ffffff',
      anim: { type: 'jitter', duration: 1, speed: 1 } },
    { tracking: -0.02 }, [createEffect('glitch', { amount: 0.45, split: 0.02 })]),
  mk('Kanji Stamp (vertical)',
    { content: '有機体研究所', font: 'Hiragino Sans', weight: 900, size: 0.16, color: '#ffffff', strokeWidth: 0.03, strokeColor: '#2f7d4f',
      anim: { type: 'fade', duration: 1.2, speed: 1 } },
    { x: 0.36, rotation: -90, tracking: 0.12 }),
  mk('Wide-Spaced Caption',
    { content: 'organic structures / analog signal', font: 'Helvetica Neue', weight: 300, size: 0.035, uppercase: true, color: '#ffffff',
      anim: { type: 'fade', duration: 1.5, speed: 1 } },
    { y: -0.4, tracking: 0.55 }),
  mk('News Ticker',
    { content: 'HIGH HUMAN LAB  ///  EXPERIMENTAL VISUAL EDITOR  ///  ROOTS  ///  STATIC  ///  SIGNAL  ///', font: 'Menlo', weight: 700, size: 0.045,
      uppercase: true, color: '#ffffff', bg: { enabled: true, color: '#1c4d33', pad: 0.5 }, anim: { type: 'ticker', duration: 8, speed: 1 } },
    { y: -0.45, tracking: 0.06 }),
  mk('Root Serif Flicker',
    { content: 'grow', font: 'Georgia', weight: 400, italic: true, size: 0.28, fit: 0.7, color: '#e9fff0',
      anim: { type: 'flicker', duration: 1, speed: 1 } },
    { tracking: 0.02 }, [createEffect('fluid', { amount: 0.03 })]),
  mk('Pulse Mono',
    { content: 'BPM', font: 'Courier New', weight: 700, size: 0.18, color: '#ffffff', anim: { type: 'pulse', duration: 1, speed: 1 } },
    {}),
  // ---- Devanagari (Hindi) ----  no letter-spacing is ever added to Devanagari: it would break the headline bar
  mk('Bollywood Gold (Rozha)',
    { content: 'रात की रानी', font: 'Rozha One', weight: 400, size: 0.15, fit: 0.82, color: '#ffe9a8', strokeWidth: 0.012, strokeColor: '#4a1500', anim: { type: 'slam', duration: 0.7, speed: 1 },
      fx: { gradient: true, gradStops: [[0, '#fff6c9'], [0.45, '#f6b73c'], [0.55, '#b8631a'], [1, '#ffd980']], shadow: 0.8, glow: 0.35 } },
    {}),
  mk('Desi Street (Teko)',
    { content: 'सड़क का राजा', font: 'Teko', weight: 700, size: 0.17, fit: 0.8, color: '#ffffff', anim: { type: 'stutter', duration: 0.7, speed: 1 }, fx: { split: 0.5, shadow: 0.6 } },
    {}),
  mk('Yatra Brush (red)',
    { content: 'यात्रा', font: 'Yatra One', weight: 400, size: 0.2, fit: 0.55, color: '#ff2d2d', strokeWidth: 0.01, strokeColor: '#2a0000', anim: { type: 'fade', duration: 0.8, speed: 1 }, fx: { shadow: 0.7, glow: 0.4 } },
    {}),
  mk('Modak Pop (bubble)',
    { content: 'मस्ती', font: 'Modak', weight: 400, size: 0.26, fit: 0.6, color: '#ffd23f', strokeWidth: 0.035, strokeColor: '#c1121f', outline2: { width: 0.06, color: '#ffffff' }, anim: { type: 'slam', duration: 0.6, speed: 1 }, fx: { shadow: 0.8 } },
    {}),
  mk('Hindi Serif (Tiro)',
    { content: 'अंधेरा', font: 'Tiro Devanagari Hindi', weight: 400, size: 0.14, fit: 0.55, color: '#f4efe3', anim: { type: 'fade', duration: 1.2, speed: 1 }, fx: { shadow: 0.5, glow: 0.15 } },
    {}),
  mk('Hindi Kicker (Tiro)',
    { content: 'एक कहानी', font: 'Tiro Devanagari Hindi', weight: 400, size: 0.05, color: '#f4efe3', anim: { type: 'fade', duration: 0.8, speed: 1 }, fx: { shadow: 0.4 } },
    { y: 0.16 }),
  mk('Khand Slab (Devanagari)',
    { content: 'दिल्ली', font: 'Khand', weight: 700, size: 0.22, fit: 0.5, color: '#ffffff', anim: { type: 'letters', duration: 1.2, speed: 1 }, fx: { shadow: 0.5 } },
    {}),
  mk('Kalam Scrawl (Hindi)',
    { content: 'दिल की बात', font: 'Kalam', weight: 700, size: 0.1, fit: 0.7, color: '#fff6d6', anim: { type: 'typewriter', duration: 1.6, speed: 1 }, fx: { shadow: 0.4 } },
    { rotation: -3 }),
  mk('Eczar Ember (Hindi)',
    { content: 'तूफ़ान', font: 'Eczar', weight: 800, size: 0.2, fit: 0.6, color: '#ff7a1a', anim: { type: 'fade', duration: 1, speed: 1 },
      fx: { gradient: true, gradStops: [[0, '#fff1b0'], [0.5, '#ff7a1a'], [1, '#9d1b00']], shadow: 0.6, glow: 0.5 } },
    {}),
  mk('Amita Calligraphy',
    { content: 'शुभ रात्रि', font: 'Amita', weight: 700, size: 0.12, fit: 0.6, color: '#f6e7b4', anim: { type: 'fade', duration: 1.2, speed: 1 }, fx: { glow: 0.4, shadow: 0.4 } },
    {}),
  mk('Martel Headline (news)',
    { content: 'ख़बर', font: 'Martel', weight: 900, size: 0.16, fit: 0.45, color: '#ffffff', bg: { enabled: true, color: '#b3001b', pad: 0.45 }, anim: { type: 'slide', duration: 0.5, speed: 1 } },
    {}),
  mk('Teko Label (Latin)',
    { content: 'LIMITED RELEASE', font: 'Teko', weight: 700, size: 0.05, uppercase: true, color: '#ffffff', anim: { type: 'fade', duration: 0.6, speed: 1 }, fx: { shadow: 0.4 } },
    { y: -0.14, tracking: 0.3 }),
  // ---- underground / street ----
  mk('Flyer Condensed (Anton)',
    { content: 'NO SLEEP', font: 'Anton', weight: 400, size: 0.22, fit: 0.9, uppercase: true, color: '#f5f5f0', anim: { type: 'stutter', duration: 0.7, speed: 1 }, fx: { split: 0.3, shadow: 0.5 } },
    { tracking: 0.02 }),
  mk('Marker Tag',
    { content: 'real ones only', font: 'Permanent Marker', weight: 400, size: 0.1, fit: 0.6, color: '#f2ff3a', anim: { type: 'fade', duration: 0.5, speed: 1 }, fx: { shadow: 0.6 } },
    { rotation: -6, y: -0.18, x: 0.12 }),
  mk('Typewriter Cover',
    { content: 'VOL. 2 — SIDE A', font: 'Special Elite', weight: 400, size: 0.04, color: '#e9e4d4', uppercase: true, bg: { enabled: true, color: '#111111', pad: 0.5 }, anim: { type: 'typewriter', duration: 1.4, speed: 1 } },
    { y: 0.2, tracking: 0.08 }),
  mk('Spray Paint Title',
    { content: 'UNDERGROUND', font: 'Rubik Spray Paint', weight: 400, size: 0.11, fit: 0.9, uppercase: true, color: '#ff3b3b', anim: { type: 'fade', duration: 0.8, speed: 1 }, fx: { glow: 0.3, shadow: 0.4 } },
    {}),
  mk('Stencil Label',
    { content: 'UNFILTERED', font: 'Black Ops One', weight: 400, size: 0.06, uppercase: true, color: '#000000', bg: { enabled: true, color: '#ffffff', pad: 0.35 }, anim: { type: 'strobe', duration: 1, speed: 0.4 } },
    { y: -0.26, tracking: 0.1 }),
  mk('Glitch Rap Title',
    { content: 'STATIC', font: 'Rubik Glitch', weight: 400, size: 0.22, fit: 0.8, uppercase: true, color: '#ffffff', anim: { type: 'jitter', duration: 1, speed: 1 }, fx: { split: 0.6 } },
    {}),
  mk('Block Heavy (Archivo)',
    { content: 'LOUD', font: 'Archivo Black', weight: 400, size: 0.25, fit: 0.7, uppercase: true, color: '#ffffff', anim: { type: 'slam', duration: 0.5, speed: 1 }, fx: { shadow: 0.6 } },
    { tracking: -0.02 }),
  mk('Scrawl (Rock Salt)',
    { content: '3am', font: 'Rock Salt', weight: 400, size: 0.1, color: '#ffffff', anim: { type: 'fade', duration: 0.6, speed: 1 }, fx: { shadow: 0.5 } },
    { rotation: -4, y: 0.2, x: -0.18 }),
  mk('Bungee Sign',
    { content: 'LIVE TONIGHT', font: 'Bungee', weight: 400, size: 0.09, fit: 0.8, uppercase: true, color: '#ffec00', anim: { type: 'flicker', duration: 1, speed: 1 }, fx: { glow: 0.8, shadow: 0.3 } },
    {}),
  mk('Bebas Credit',
    { content: 'PRODUCED BY HHL', font: 'Bebas Neue', weight: 400, size: 0.045, uppercase: true, color: '#ffffff', anim: { type: 'fade', duration: 0.6, speed: 1 }, fx: { shadow: 0.3 } },
    { y: 0.16, tracking: 0.3 }),
  mk('Ad-lib Pop (marker)',
    { content: 'yeah!', font: 'Permanent Marker', weight: 400, size: 0.09, color: '#ffffff', anim: { type: 'slam', duration: 0.3, speed: 1 }, fx: { shadow: 0.7, split: 0.2 } },
    { rotation: 8, x: 0.22, y: 0.18 }),
];

export function createTextClip(preset, start, duration = 4) {
  const base = defaultText();
  const t = preset?.text || {};
  const text = { ...base, ...t, bg: { ...base.bg, ...(t.bg || {}) }, anim: { ...base.anim, ...(t.anim || {}) }, fx: { ...base.fx, ...(t.fx || {}) } };
  return createClip({
    type: 'text',
    name: preset?.name || 'Text',
    start,
    duration,
    text,
    props: { ...defaultProps(), ...(preset?.props || {}) },
    effects: (preset?.effects || []).map((e) => structuredClone(e)),
  });
}

/** Kicker + title pairs. Each side names a preset and the text to put in it (kicker also carries position overrides). */
export const LOCKUPS = [
  { name: 'Rose script', kicker: { preset: 'Script Kicker (small caps)', text: 'IN' }, title: { preset: 'Script Title (rose)', text: 'Moore Next Door' } },
  { name: 'Y2K × 日本語', kicker: { preset: 'Cyber Katakana (pixel)', text: 'サイバー・ガーデン', size: 0.04, fit: 0.5, y: 0.17 }, title: { preset: 'Y2K Chrome Bubble', text: 'CYBER\nGARDEN', y: -0.02 } },
  { name: 'Gothic × 明朝', kicker: { preset: 'Tokyo Vertical (mincho)', text: '夜の庭', vertical: false, size: 0.045, x: 0, y: 0.17, tracking: 0.35 }, title: { preset: 'Gothic Drop (blackletter)', text: 'Night Garden', y: -0.02 } },
  { name: 'Techno spec', kicker: { preset: 'Techno Spec Sheet', text: 'SYSTEM // 01', align: 'center', x: 0, y: 0.15, size: 0.03 }, title: { preset: 'Orbitron Loading (Y2K)', text: 'ORGANIC OS', size: 0.12, fit: 0.82, y: 0, tracking: 0.12, color: '#e9f4ff', anim: 'fade' } },
  // ---- Hindi / desi ----
  { name: 'Filmi poster (3 fonts)', kicker: { preset: 'Script Kicker (small caps)', text: 'a HHL film', size: 0.045, x: 0, y: 0.27, tracking: 0.3 }, title: { preset: 'Bollywood Gold (Rozha)', text: 'रात की रानी', fit: 0.6, y: 0 }, sub: { preset: 'Teko Label (Latin)', text: 'NIGHT QUEEN · 2026', y: -0.22 } },
  { name: 'Desi street (2 fonts)', kicker: { preset: 'Hindi Kicker (Tiro)', text: 'दिल्ली से', y: 0.2 }, title: { preset: 'Desi Street (Teko)', text: 'सड़क का राजा', y: -0.01 } },
  { name: 'Modak × credit (2 fonts)', kicker: { preset: 'Bebas Credit', text: 'PRESENTS', y: 0.3 }, title: { preset: 'Modak Pop (bubble)', text: 'मस्ती', fit: 0.4, y: -0.03 } },
  // ---- underground ----
  { name: 'Mixtape cover (3 fonts)', kicker: { preset: 'Typewriter Cover', text: 'VOL. 2 — SIDE A', y: 0.28 }, title: { preset: 'Flyer Condensed (Anton)', text: 'NO SLEEP', fit: 0.55, y: 0 }, sub: { preset: 'Marker Tag', text: 'real ones only', rotation: -6, x: 0.12, y: -0.21 } },
  { name: 'Spray crew (3 fonts)', kicker: { preset: 'Scrawl (Rock Salt)', text: '3am', x: -0.2, y: 0.21 }, title: { preset: 'Spray Paint Title', text: 'UNDERGROUND', y: 0 }, sub: { preset: 'Stencil Label', text: 'UNFILTERED', y: -0.18 } },
  { name: 'Blackletter street (3 fonts)', kicker: { preset: 'Typewriter Cover', text: 'EST. IN THE BASEMENT', y: 0.25 }, title: { preset: 'Gothic Drop (blackletter)', text: 'Dead End', fit: 0.6, y: 0 }, sub: { preset: 'Marker Tag', text: 'no features', rotation: 4, x: -0.1, y: -0.21 } },
  { name: 'Flyer night (2 fonts)', kicker: { preset: 'Bebas Credit', text: 'LIVE · ONE NIGHT ONLY', y: 0.2 }, title: { preset: 'Block Heavy (Archivo)', text: 'LOUD', y: -0.01 } },
  { name: 'Static broadcast (2 fonts)', kicker: { preset: 'Techno Spec Sheet', text: 'SIGNAL LOST // 404', align: 'center', x: 0, y: 0.17, size: 0.03 }, title: { preset: 'Glitch Rap Title', text: 'STATIC', y: -0.01 } },
];

/** The two-line title card from the editorial reference: kicker above, script title below. Returns [kicker, title] (not yet on a track). */
export function createTitleLockup(start, duration = 4, { lockup = 'Rose script', kicker, title } = {}) {
  const L = LOCKUPS.find((x) => x.name === lockup) || LOCKUPS[0];
  const build = (side, override, label) => {
    const c = createTextClip(TEXT_PRESETS.find((p) => p.name === side.preset), start, duration);
    const text = override ?? side.text;
    c.text.content = text; c.name = `${label} · ${text.replace(/\n/g, ' ')}`;
    for (const k of ['size', 'fit', 'vertical', 'align', 'color']) if (side[k] !== undefined) c.text[k] = side[k];
    if (side.anim) c.text.anim = { ...c.text.anim, type: side.anim };
    for (const k of ['x', 'y', 'tracking', 'rotation']) if (side[k] !== undefined) c.props[k] = side[k];
    return c;
  };
  return [build(L.kicker, kicker, 'Kicker'), build(L.title, title, 'Title'), ...(L.sub ? [build(L.sub, undefined, 'Sub')] : [])];
}

/** Distinct fonts a lockup combines (shown in the Type panel). */
export function lockupFonts(L) {
  const fonts = [L.kicker, L.title, L.sub].filter(Boolean).map((s) => TEXT_PRESETS.find((p) => p.name === s.preset)?.text.font);
  return [...new Set(fonts)];
}
