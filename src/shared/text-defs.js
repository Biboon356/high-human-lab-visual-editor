// Typography Lab definitions: default style, animations, and experimental presets.
import { createClip, defaultProps } from './project.js';
import { createEffect } from './effects-defs.js';
import { createShapeClip } from './shape-defs.js';
import { createAdjustClip, VEIL_LOOKS } from './adjust-defs.js';

export const FONTS = [
  'DotGothic16', 'Zen Antique', 'Dela Gothic One', 'Rozha One', 'Yatra One', 'Modak', 'Tiro Devanagari Hindi', 'Eczar', 'Teko', 'Khand', 'Kalam', 'Amita', 'Martel', 'Dekko', 'Gotu', 'Inknut Antiqua', 'Jaini', 'Kurale', 'Sarpanch', 'Tillana', 'Anton', 'Permanent Marker', 'Special Elite', 'Rubik Spray Paint', 'Black Ops One', 'Rubik Glitch', 'Archivo Black', 'Rock Salt', 'Bungee', 'Bebas Neue', 'Rubik Distressed', 'Londrina Solid', 'Reenie Beanie', 'Covered By Your Grace', 'Courier Prime', 'Monoton', 'Shrikhand', 'Righteous', 'Audiowide', 'Space Grotesk', 'Space Mono', 'Syne', 'Unbounded', 'Big Shoulders Display', 'Metal Mania', 'New Rocker', 'Cinzel Decorative', 'Grenze Gotisch', 'IM Fell English SC', 'Michroma', 'Orbitron', 'Press Start 2P', 'UnifrakturCook', 'Pirata One', 'Pinyon Script', 'Instrument Serif', 'Inter Tight', 'DM Mono', 'Helvetica Neue', 'Arial Black', 'Impact', 'Futura', 'Courier New', 'Menlo', 'Consolas',
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
    ransom: false, // cut-out letters: every letter on its own scrap of paper, in its own typeface, slightly crooked
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
  mk('Hindi Kicker (Tiro)',
    { content: 'एक कहानी', font: 'Tiro Devanagari Hindi', weight: 400, size: 0.05, color: '#f4efe3', anim: { type: 'fade', duration: 0.8, speed: 1 }, fx: { shadow: 0.4 } },
    { y: 0.16 }),
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
  mk('Teko Label (Latin)',
    { content: 'LIMITED RELEASE', font: 'Teko', weight: 700, size: 0.05, uppercase: true, color: '#ffffff', anim: { type: 'fade', duration: 0.6, speed: 1 }, fx: { shadow: 0.4 } },
    { y: -0.14, tracking: 0.3 }),
  // Letters with cracks of colour running through them: the Veins effect in Invert mode, clinging to the edges inside the letters.
  mk('Cracked Type (veins)',
    { content: 'ROOTS', font: 'Dela Gothic One', weight: 400, size: 0.3, fit: 0.8, color: '#e8efe9' },
    {}, [createEffect('veins', { mode: 2, origin: 5, growth: 1, density: 3.2, thickness: 0.2, glow: 1.1, cling: 1, color: '#ff4fd8' })]),
  // ---- Hindi, spiritual / niche: hand-lettered, carved and brushed faces with a gold-leaf, stone or flame finish ----
  mk('Dhyaan Gold Leaf (Tillana)',
    { content: 'ध्यान', font: 'Tillana', weight: 700, size: 0.26, fit: 0.5, color: '#f2c46b', anim: { type: 'fade', duration: 2.2, speed: 1 },
      fx: { gradient: true, gradStops: [[0, '#fff3cc'], [0.34, '#eab84f'], [0.5, '#a8691c'], [0.63, '#f6d27a'], [1, '#8a4a12']], glow: 0.45, shadow: 0.55 } },
    {}, [createEffect('grain', { amount: 0.14, size: 1.3, color: 0 }), createEffect('bloom', { threshold: 0.6, intensity: 0.3, radius: 30 })]),
  mk('Shanti Carved (Inknut)',
    { content: 'शांति', font: 'Inknut Antiqua', weight: 400, size: 0.2, fit: 0.55, color: '#e9e1cf', anim: { type: 'fade', duration: 2.4, speed: 1 },
      fx: { gradient: true, gradStops: [[0, '#fbf6ea'], [1, '#b0a388']], shadow: 0.85, glow: 0.08 } },
    {}, [createEffect('grain', { amount: 0.2, size: 1.4, color: 0 })]),
  mk('Jyoti Flame (Dekko)',
    { content: 'ज्योति', font: 'Dekko', weight: 400, size: 0.24, fit: 0.5, color: '#ffcf7a', anim: { type: 'flicker', duration: 1.2, speed: 0.7 },
      fx: { gradient: true, gradStops: [[0, '#fff6d0'], [0.55, '#ff9d2e'], [1, '#d1380c']], glow: 0.9, shadow: 0.3 } },
    {}, [createEffect('bloom', { threshold: 0.55, intensity: 0.45, radius: 34 })]),
  mk('Satya Stone (Jaini)',
    { content: 'सत्य', font: 'Jaini', weight: 400, size: 0.25, fit: 0.42, color: '#d8c9a6', anim: { type: 'fade', duration: 1.8, speed: 1 },
      fx: { gradient: true, gradStops: [[0, '#f1e6c8'], [1, '#8f7d57']], shadow: 0.95 } },
    {}, [createEffect('grain', { amount: 0.24, size: 1.5, color: 0 })]),
  mk('Moksha Ember (Inknut)',
    { content: 'मोक्ष', font: 'Inknut Antiqua', weight: 800, size: 0.22, fit: 0.5, color: '#d9a441', anim: { type: 'fade', duration: 1.6, speed: 1 },
      fx: { gradient: true, gradStops: [[0, '#ffe7a8'], [0.5, '#d9892b'], [1, '#7e1f0c']], glow: 0.5, shadow: 0.6 } },
    {}, [createEffect('grain', { amount: 0.12, size: 1.2, color: 0 })]),
  mk('Sadhana Ink (Kurale)',
    { content: 'साधना', font: 'Kurale', weight: 400, size: 0.16, fit: 0.5, color: '#f1e9d6', anim: { type: 'fade', duration: 1.6, speed: 1 }, fx: { shadow: 0.4, glow: 0.12 } },
    {}),
  mk('Maun Whisper (Gotu)',
    { content: 'मौन', font: 'Gotu', weight: 400, size: 0.14, fit: 0.3, color: '#d8d2c4', anim: { type: 'fade', duration: 3, speed: 1 }, fx: { glow: 0.3 } },
    {}),
  mk('Bhavishya Cyber (Sarpanch)',
    { content: 'भविष्य', font: 'Sarpanch', weight: 800, size: 0.2, fit: 0.55, color: '#bff6ff', anim: { type: 'stutter', duration: 0.7, speed: 1 }, fx: { glow: 0.9, split: 0.4, shadow: 0.2 } },
    {}),
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
  // ---- zine / punk ----
  mk('Ransom Note (cut-out)',
    { content: 'NO FUTURE', font: 'Anton', weight: 400, size: 0.16, fit: 0.8, ransom: true, anim: { type: 'fade', duration: 0.4, speed: 1 } },
    {}),
  mk('Zine Title (distressed)',
    { content: 'ZINE NIGHT', font: 'Rubik Distressed', weight: 400, size: 0.15, fit: 0.85, uppercase: true, color: '#f4efe3', anim: { type: 'stutter', duration: 0.7, speed: 1 }, fx: { shadow: 0.4 } },
    {}),
  mk('Scrawl Marker (zine)',
    { content: 'diy', font: 'Covered By Your Grace', weight: 400, size: 0.1, color: '#ff2e88', anim: { type: 'fade', duration: 0.5, speed: 1 }, fx: { shadow: 0.4 } },
    { rotation: -5, x: -0.2, y: 0.2 }),
  mk('Beanie Scribble',
    { content: 'handmade', font: 'Reenie Beanie', weight: 400, size: 0.09, color: '#ffffff', anim: { type: 'typewriter', duration: 1, speed: 1 }, fx: { shadow: 0.3 } },
    { rotation: 3, y: -0.2 }),
  mk('Courier Caption',
    { content: 'xerox + staples + noise', font: 'Courier Prime', weight: 700, size: 0.04, uppercase: true, color: '#e9e4d4', anim: { type: 'typewriter', duration: 1.4, speed: 1 } },
    { y: -0.2, tracking: 0.1 }),
  mk('Hand Cut (Londrina)',
    { content: 'HAND CUT', font: 'Londrina Solid', weight: 900, size: 0.16, fit: 0.7, uppercase: true, color: '#f2ff3a', anim: { type: 'slam', duration: 0.5, speed: 1 }, fx: { shadow: 0.6 } },
    { rotation: -2 }),
  // ---- vaporwave / city pop ----
  mk('Neon Line (Monoton)',
    { content: 'NIGHT DRIVE', font: 'Monoton', weight: 400, size: 0.1, fit: 0.85, uppercase: true, color: '#ff4fd8', anim: { type: 'flicker', duration: 1, speed: 1 }, fx: { glow: 0.95, shadow: 0.2 } },
    {}),
  mk('Vapor Script (Shrikhand)',
    { content: 'City Lights', font: 'Shrikhand', weight: 400, size: 0.16, fit: 0.75, color: '#ff4fa8', anim: { type: 'fade', duration: 1, speed: 1 },
      fx: { gradient: true, gradStops: [[0, '#ffe3f6'], [0.5, '#ff4fa8'], [1, '#7a2cff']], shadow: 0.6, glow: 0.5 } },
    {}),
  mk('Righteous Label',
    { content: 'MIDNIGHT FM', font: 'Righteous', weight: 400, size: 0.06, uppercase: true, color: '#7df9ff', anim: { type: 'fade', duration: 0.6, speed: 1 }, fx: { glow: 0.5 } },
    { tracking: 0.25 }),
  mk('Audiowide Tag',
    { content: 'LIVE FROM TOKYO 1987', font: 'Audiowide', weight: 400, size: 0.045, uppercase: true, color: '#ffe9a8', anim: { type: 'fade', duration: 0.6, speed: 1 }, fx: { glow: 0.4 } },
    { tracking: 0.2 }),
  // ---- brutalist / Swiss ----
  mk('Swiss Mono Label',
    { content: '(01) — NEW ORDER', font: 'Space Mono', weight: 700, size: 0.035, fit: 0.26, uppercase: true, color: '#f2f2ee', align: 'left', anim: { type: 'typewriter', duration: 1, speed: 1 } },
    { x: -0.33, y: 0.3 }),
  mk('Big Shoulders Stack',
    { content: 'CONCRETE', font: 'Big Shoulders Display', weight: 900, size: 0.28, fit: 0.88, uppercase: true, color: '#f2f2ee', lineHeight: 0.9, anim: { type: 'slam', duration: 0.5, speed: 1 } },
    { y: 0.02 }),
  mk('Grotesk Caption (red)',
    { content: 'Lagos / Berlin / Seoul', font: 'Space Grotesk', weight: 700, size: 0.04, fit: 0.34, color: '#ff3b1f', align: 'left', anim: { type: 'fade', duration: 0.6, speed: 1 } },
    { x: -0.31, y: -0.28 }),
  mk('Unbounded Hard (wide)',
    { content: 'HARD EDGE', font: 'Unbounded', weight: 900, size: 0.09, fit: 0.9, uppercase: true, color: '#ffffff', anim: { type: 'slam', duration: 0.5, speed: 1 } },
    {}),
  mk('Syne Whisper',
    { content: 'volume nine', font: 'Syne', weight: 800, size: 0.05, color: '#ff3b1f', anim: { type: 'fade', duration: 0.6, speed: 1 } },
    { y: 0.17 }),
  // ---- dark / metal ----
  mk('Metal Logo (Metal Mania)',
    { content: 'NECROPOLIS', font: 'Metal Mania', weight: 400, size: 0.15, fit: 0.85, uppercase: true, color: '#e8e2d4', strokeWidth: 0.012, strokeColor: '#000000', anim: { type: 'fade', duration: 1.2, speed: 1 }, fx: { glow: 0.3, shadow: 0.8 } },
    {}),
  mk('Gotisch Heavy',
    { content: 'Iron Wolves', font: 'Grenze Gotisch', weight: 900, size: 0.15, fit: 0.8, color: '#d9d2c0', anim: { type: 'fade', duration: 1.2, speed: 1 }, fx: { shadow: 0.7, glow: 0.15 } },
    {}),
  mk('New Rocker Title',
    { content: 'IRON WOLVES', font: 'New Rocker', weight: 400, size: 0.13, fit: 0.8, uppercase: true, color: '#c1121f', strokeWidth: 0.012, strokeColor: '#1a0000', anim: { type: 'slam', duration: 0.6, speed: 1 }, fx: { shadow: 0.8, glow: 0.4 } },
    {}),
  mk('Cinzel Kicker',
    { content: 'LIVE', font: 'Cinzel Decorative', weight: 900, size: 0.06, uppercase: true, color: '#d9c27a', anim: { type: 'fade', duration: 0.8, speed: 1 }, fx: { glow: 0.3 } },
    { tracking: 0.3 }),
  mk('Fell Whisper',
    { content: 'in the year of the long night', font: 'IM Fell English SC', weight: 400, size: 0.045, color: '#cfc6b2', anim: { type: 'fade', duration: 1.2, speed: 1 }, fx: { shadow: 0.4 } },
    { tracking: 0.1 }),
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
  // ---- Hindi, spiritual ----
  { name: 'Dhyaan · gold leaf (3 fonts)', kicker: { preset: 'Fell Whisper', text: 'silence is a practice', size: 0.042, y: 0.3 }, title: { preset: 'Dhyaan Gold Leaf (Tillana)', text: 'ध्यान', y: 0.03 }, sub: { preset: 'Cinzel Kicker', text: 'MEDITATION', size: 0.04, y: -0.3, tracking: 0.5 },
    deco: [{ veil: 'Gold mandala veil', name: 'Mandala', patch: { pattern: { scale: 0.92 } } }, { shape: 'divider', set: { w: 0.3, h: 0.028, color: '#d9b45a', stroke: 0.0025 }, y: -0.2, delay: 0.5, fadeIn: 1 }] },
  { name: 'Jyoti · flame (3 fonts)', kicker: { preset: 'Cinzel Kicker', text: 'LIGHT', size: 0.045, y: -0.27, tracking: 0.55 }, title: { preset: 'Jyoti Flame (Dekko)', text: 'ज्योति', y: -0.07 }, sub: { preset: 'Fell Whisper', text: 'a small flame is enough', size: 0.04, y: -0.34 },
    deco: [{ shape: 'flame', set: { w: 0.1, h: 0.2, glow: 0.9, color: '#ff9d2e', color2: '#fff3b0' }, y: 0.31, fadeIn: 1.2, name: 'Diya flame' }, { shape: 'rosette', set: { size: 0.62, color: '#d9a441', stroke: 0.002, glow: 0.4 }, y: 0.02, opacity: 0.35, name: 'Rosette' }] },
  { name: 'Moksha · arch (2 fonts)', kicker: { preset: 'Fell Whisper', text: 'beyond the wheel', size: 0.04, y: 0.27 }, title: { preset: 'Moksha Ember (Inknut)', text: 'मोक्ष', fit: 0.2, y: -0.04 },
    deco: [{ veil: 'Lattice veil' }, { shape: 'arch', set: { w: 0.28, h: 0.84, color: '#d9a441', stroke: 0.004, glow: 0.35, ratio: 0.6 }, name: 'Arch' }, { shape: 'divider', set: { w: 0.15, h: 0.022, color: '#d9a441', stroke: 0.002 }, y: -0.2, delay: 0.6, fadeIn: 1 }],
    over: [{ shape: 'star', set: { size: 0.05, color: '#ffe9a8', n: 4, ratio: 0.22, glow: 0.8 }, y: 0.4, delay: 0.8, fadeIn: 0.8 }] },
  { name: 'Satya · stone (3 fonts)', kicker: { preset: 'Typewriter Cover', text: 'EST. BEFORE WORDS', y: 0.28, size: 0.028 }, title: { preset: 'Satya Stone (Jaini)', text: 'सत्य', y: 0 }, sub: { preset: 'Fell Whisper', text: 'truth', size: 0.05, y: -0.27 },
    deco: [{ shape: 'frame', set: { w: 0.7, h: 0.8, color: '#cdbf9a', stroke: 0.003 }, name: 'Frame' }],
    over: [{ shape: 'star', set: { size: 0.045, color: '#cdbf9a', n: 4, ratio: 0.25 }, x: -0.35, y: 0.4 }, { shape: 'star', set: { size: 0.045, color: '#cdbf9a', n: 4, ratio: 0.25 }, x: 0.35, y: 0.4 }, { shape: 'star', set: { size: 0.045, color: '#cdbf9a', n: 4, ratio: 0.25 }, x: -0.35, y: -0.4 }, { shape: 'star', set: { size: 0.045, color: '#cdbf9a', n: 4, ratio: 0.25 }, x: 0.35, y: -0.4 }] },
  { name: 'Future sutra (3 fonts)', kicker: { preset: 'Techno Spec Sheet', text: 'SIGNAL // SUTRA 01', align: 'center', x: 0, y: 0.3, size: 0.026 }, title: { preset: 'Bhavishya Cyber (Sarpanch)', text: 'भविष्य', y: -0.02 }, sub: { preset: 'Righteous Label', text: 'THE FUTURE LISTENS', size: 0.04, y: -0.3 },
    deco: [{ shape: 'sun', set: { size: 0.8, color: '#7df9ff', n: 36, ratio: 0.55, glow: 0.3 }, opacity: 0.22, name: 'Rays' }, { shape: 'dotrow', set: { w: 0.4, h: 0.012, color: '#7df9ff', n: 15 }, y: -0.2 }] },
  // ---- desi ----
  { name: 'Filmi poster (3 fonts)', kicker: { preset: 'Script Kicker (small caps)', text: 'a HHL film', size: 0.045, x: 0, y: 0.3, tracking: 0.3 }, title: { preset: 'Bollywood Gold (Rozha)', text: 'रात की रानी', fit: 0.58, y: 0 }, sub: { preset: 'Teko Label (Latin)', text: 'NIGHT QUEEN · 2026', size: 0.05, y: -0.25 },
    deco: [{ shape: 'sun', set: { size: 0.95, color: '#ffcf5a', n: 28, ratio: 0.3 }, opacity: 0.16, name: 'Rays' }, { shape: 'frame', set: { w: 0.9, h: 0.88, color: '#e8c36a', stroke: 0.003 }, name: 'Frame' }],
    over: [{ shape: 'flame', set: { w: 0.04, h: 0.085, glow: 0.8, color: '#ff9d2e', color2: '#fff3b0' }, x: -0.36, y: -0.33, name: 'Diya' }, { shape: 'flame', set: { w: 0.04, h: 0.085, glow: 0.8, color: '#ff9d2e', color2: '#fff3b0' }, x: 0.36, y: -0.33, name: 'Diya' }] },
  { name: 'Truck-art desi (3 fonts)', kicker: { preset: 'Kalam Scrawl (Hindi)', text: 'दिल्ली से', size: 0.075, fit: 0.2, y: 0.25, rotation: -3 }, title: { preset: 'Desi Street (Teko)', text: 'सड़क का राजा', fit: 0.74, y: -0.01, color: '#ffe066', fx: { split: 0.15, shadow: 0.8 } }, sub: { preset: 'Bebas Credit', text: 'HORN OK PLEASE', y: -0.24, size: 0.06, tracking: 0.35 },
    deco: [{ veil: 'Truck-art border veil' }, { shape: 'stripes', set: { w: 1.1, h: 0.04, n: 40 }, y: 0.45, rotation: 0 }] },
  // ---- underground ----
  { name: 'Mixtape cover (3 fonts)', kicker: { preset: 'Typewriter Cover', text: 'VOL. 2 — SIDE A', y: 0.3, x: -0.27, size: 0.032, color: '#111111', bg: { enabled: false }, anim: 'fade' }, title: { preset: 'Flyer Condensed (Anton)', text: 'NO SLEEP', fit: 0.7, y: -0.04, size: 0.3 }, sub: { preset: 'Marker Tag', text: 'real ones only', rotation: -6, x: 0.14, y: -0.22, fit: 0.2, size: 0.07 },
    deco: [{ shape: 'rect', set: { w: 0.8, h: 0.3, color: '#e3262e' }, y: -0.03, rotation: -2.2, effects: [['grain', { amount: 0.22 }]], name: 'Red block' }, { shape: 'rect', set: { w: 0.3, h: 0.07, color: '#efe9dc' }, x: -0.27, y: 0.3, rotation: -1.5, name: 'Label plate' }],
    over: [{ shape: 'tape', set: { w: 0.18, h: 0.055 }, x: -0.41, y: 0.35, rotation: -38, name: 'Tape' }, { shape: 'tape', set: { w: 0.18, h: 0.055 }, x: 0.41, y: -0.33, rotation: -38, name: 'Tape' }] },
  { name: 'Xerox flyer (3 fonts)', kicker: { preset: 'Bebas Credit', text: 'LIVE · ONE NIGHT ONLY', y: 0.3, size: 0.06, color: '#111111', tracking: 0.28 }, title: { preset: 'Block Heavy (Archivo)', text: 'LOUD', fit: 0.5, y: 0.02, color: '#111111', fx: { shadow: 0 } }, sub: { preset: 'Courier Caption', text: 'DOORS 9PM / NO PHONES', y: -0.26, color: '#111111', size: 0.034 },
    deco: [{ shape: 'rect', set: { w: 0.86, h: 0.88, color: '#efe9dc' }, rotation: -1.4, effects: [['torn', { amount: 0.3, rough: 7, shadow: 0.6 }], ['grain', { amount: 0.25 }]], name: 'Paper' }],
    over: [{ shape: 'stripes', set: { w: 0.8, h: 0.045, n: 30 }, y: -0.37, rotation: -1.4 }, { shape: 'ellipse', set: { size: 0.05, color: '#e3262e' }, x: 0.37, y: 0.34 }] },
  { name: 'Ransom zine (2 fonts)', kicker: { preset: 'Typewriter Cover', text: 'ISSUE #04 — PHOTOCOPIED', y: 0.3, size: 0.03 }, title: { preset: 'Ransom Note (cut-out)', text: 'NO FUTURE', fit: 0.66, y: -0.03 },
    deco: [{ shape: 'rect', set: { w: 0.84, h: 0.74, color: '#e8e1d0' }, rotation: 1.2, effects: [['torn', { amount: 0.4, rough: 6, shadow: 0.7 }], ['grain', { amount: 0.3 }]], name: 'Paper' }],
    over: [{ shape: 'tape', set: { w: 0.18, h: 0.055 }, x: -0.37, y: 0.34, rotation: -38 }, { shape: 'tape', set: { w: 0.18, h: 0.055 }, x: 0.37, y: 0.34, rotation: 38 }] },
  { name: 'Spray crew (3 fonts)', kicker: { preset: 'Scrawl (Rock Salt)', text: '3am', x: -0.3, y: 0.15, size: 0.09 }, title: { preset: 'Spray Paint Title', text: 'UNDERGROUND', fit: 0.74, y: -0.02 }, sub: { preset: 'Stencil Label', text: 'UNFILTERED', y: -0.2, size: 0.05, anim: 'fade' },
    deco: [{ shape: 'rect', set: { w: 0.9, h: 0.46, color: '#0a0a0a' }, rotation: -1.4, opacity: 0.88, effects: [['torn', { amount: 0.25, rough: 8, shadow: 0.5 }]], name: 'Black plate' }],
    over: [{ shape: 'stripes', set: { w: 0.9, h: 0.035, n: 36 }, y: 0.27, rotation: -1.4 }, { shape: 'stripes', set: { w: 0.9, h: 0.035, n: 36 }, y: -0.29, rotation: -1.4 }] },
  { name: 'Blackletter street (3 fonts)', kicker: { preset: 'Typewriter Cover', text: 'EST. IN THE BASEMENT', y: 0.27, size: 0.03 }, title: { preset: 'Gothic Drop (blackletter)', text: 'Dead End', fit: 0.56, y: -0.02 }, sub: { preset: 'Marker Tag', text: 'no features', rotation: 3, x: 0.02, y: -0.22, size: 0.07, fit: 0.2 },
    deco: [{ shape: 'frame', set: { w: 0.78, h: 0.72, color: '#d9d2c0', stroke: 0.002 }, name: 'Frame' }, { veil: 'Scan veil' }],
    over: [{ shape: 'diamond', set: { size: 0.025, color: '#d9d2c0' }, x: -0.39, y: 0 }, { shape: 'diamond', set: { size: 0.025, color: '#d9d2c0' }, x: 0.39, y: 0 }] },
  // ---- vaporwave / city pop ----
  { name: 'Vapor sign (3 fonts)', kicker: { preset: 'Cyber Katakana (pixel)', text: 'ネオンの夜', size: 0.06, fit: 0.3, y: 0.27 }, title: { preset: 'Vapor Script (Shrikhand)', text: 'City Lights', fit: 0.6, y: 0 }, sub: { preset: 'Audiowide Tag', text: 'LIVE FROM TOKYO 1987', y: -0.23 },
    deco: [{ shape: 'retrosun', set: { size: 0.62 }, y: 0.04, opacity: 0.55, name: 'Sun' }] },
  { name: 'Neon line (2 fonts)', kicker: { preset: 'Righteous Label', text: 'MIDNIGHT FM', y: 0.2 }, title: { preset: 'Neon Line (Monoton)', text: 'NIGHT DRIVE', fit: 0.7, y: -0.02 },
    deco: [{ shape: 'frame', set: { w: 0.8, h: 0.5, stroke: 0.004, color: '#7df9ff', glow: 0.9 }, name: 'Neon frame' }, { shape: 'dotrow', set: { w: 0.3, h: 0.012, color: '#ff4fd8', n: 11, glow: 0.8 }, y: -0.17 }] },
  // ---- brutalist / Swiss ----
  { name: 'Swiss grid (3 fonts)', kicker: { preset: 'Swiss Mono Label', text: '(01) — NEW ORDER', x: -0.3 }, title: { preset: 'Big Shoulders Stack', text: 'CONCRETE', fit: 0.7, y: 0 }, sub: { preset: 'Grotesk Caption (red)', text: 'Lagos / Berlin / Seoul', x: -0.28 },
    deco: [{ shape: 'ellipse', set: { size: 0.34, color: '#e5261f' }, x: 0.3, y: 0.03, name: 'Red disc' }, { shape: 'rect', set: { w: 0.86, h: 0.004, color: '#f2f2ee' }, y: 0.37 }, { shape: 'rect', set: { w: 0.86, h: 0.004, color: '#f2f2ee' }, y: -0.37 }] },
  { name: 'Brutal wide (2 fonts)', kicker: { preset: 'Syne Whisper', text: 'volume nine', y: 0.145, x: -0.29, size: 0.045 }, title: { preset: 'Unbounded Hard (wide)', text: 'HARD EDGE', fit: 0.74, y: -0.05, color: '#0b0b0b' },
    deco: [{ shape: 'rect', set: { w: 0.86, h: 0.42, color: '#f2f2ee' }, y: 0, name: 'White plate' }],
    over: [{ shape: 'rect', set: { w: 0.04, h: 0.04, color: '#e5261f' }, x: 0.4, y: 0.13 }] },
  // ---- dark / metal ----
  { name: 'Black metal logo (2 fonts)', kicker: { preset: 'Fell Whisper', text: 'in the year of the long night', y: 0.22 }, title: { preset: 'Metal Logo (Metal Mania)', text: 'NECROPOLIS', fit: 0.7, y: -0.02 } },
  { name: 'Crypt poster (3 fonts)', kicker: { preset: 'Cinzel Kicker', text: 'LIVE', y: 0.33, size: 0.05 }, title: { preset: 'New Rocker Title', text: 'IRON\nWOLVES', fit: 0.36, y: -0.02, size: 0.2 }, sub: { preset: 'Fell Whisper', text: 'one night in hell', y: -0.32 },
    deco: [{ veil: 'Scan veil' }, { shape: 'arch', set: { w: 0.5, h: 0.9, color: '#8a1c1c', stroke: 0.005, glow: 0.4, ratio: 0.6 }, name: 'Arch' }],
    over: [{ shape: 'divider', set: { w: 0.28, h: 0.022, color: '#b8a36a', stroke: 0.002 }, y: -0.25 }, { shape: 'star', set: { size: 0.035, color: '#b8a36a', n: 4, ratio: 0.25 }, y: 0.39 }] },
];


/**
 * A title lockup as a stack of ordinary clips. Text parts (kicker / title / sub) may carry extra effects and a delay; `deco` (below the
 * words) and `over` (above them) hold shapes — { shape, set, x, y, rotation, scale, opacity, delay, fadeIn, effects } — and pattern
 * veils — { veil, patch, opacity }. Returns { clips (bottom → top, ready for one track each), kicker, title }.
 */
export function createLockupClips(start, duration = 4, { lockup = 'Rose script', kicker, title } = {}) {
  const L = LOCKUPS.find((x) => x.name === lockup) || LOCKUPS[0];
  const timing = (c, d) => {
    if (d.delay) { c.start += d.delay; c.duration = Math.max(0.2, c.duration - d.delay); }
    if (d.fadeIn !== undefined) c.fadeIn = d.fadeIn;
    if (d.fadeOut !== undefined) c.fadeOut = d.fadeOut;
    for (const [type, params] of d.effects || []) c.effects.push(createEffect(type, params));
    return c;
  };
  const text = (side, override, label) => {
    const c = createTextClip(TEXT_PRESETS.find((p) => p.name === side.preset), start, duration);
    const words = override ?? side.text;
    c.text.content = words; c.name = `${label} · ${words.replace(/\n/g, ' ')}`;
    for (const k of ['size', 'fit', 'vertical', 'align', 'color', 'ransom', 'uppercase', 'weight']) if (side[k] !== undefined) c.text[k] = side[k];
    if (side.fx) c.text.fx = { ...c.text.fx, ...side.fx };
    if (side.bg) c.text.bg = { ...c.text.bg, ...side.bg };
    if (side.strokeWidth !== undefined) c.text.strokeWidth = side.strokeWidth;
    if (side.anim) c.text.anim = { ...c.text.anim, type: side.anim };
    for (const k of ['x', 'y', 'tracking', 'rotation', 'scale', 'opacity']) if (side[k] !== undefined) c.props[k] = side[k];
    return timing(c, side);
  };
  const deco = (d) => {
    let c;
    if (d.veil) {
      const look = VEIL_LOOKS.find((l) => l.name === d.veil);
      c = createAdjustClip(look, start, duration);
      for (const fx of c.effects) Object.assign(fx.params, d.patch?.[fx.type] || {});
    } else c = createShapeClip(d.shape, start, duration, d.set || {});
    for (const k of ['x', 'y', 'rotation', 'scale', 'opacity']) if (d[k] !== undefined) c.props[k] = d[k];
    if (d.name) c.name = d.name;
    return timing(c, d);
  };
  const k = text(L.kicker, kicker, 'Kicker'), ti = text(L.title, title, 'Title'), sub = L.sub ? text(L.sub, undefined, 'Sub') : null;
  return { clips: [...(L.deco || []).map(deco), ...(sub ? [sub] : []), k, ti, ...(L.over || []).map(deco)], kicker: k, title: ti };
}

/** Kicker + title (+ sub) — the text clips of a lockup, for callers that only place words (the montage title card). */
export function createTitleLockup(start, duration = 4, opts = {}) {
  const { clips } = createLockupClips(start, duration, opts);
  const words = clips.filter((c) => c.type === 'text');
  return words.length ? [words.find((c) => c.name.startsWith('Kicker')), words.find((c) => c.name.startsWith('Title')), ...words.filter((c) => c.name.startsWith('Sub'))] : [];
}

/** Distinct fonts a lockup combines (shown in the Type panel). */
export function lockupFonts(L) {
  const fonts = [L.kicker, L.title, L.sub].filter(Boolean).map((s) => TEXT_PRESETS.find((p) => p.name === s.preset)?.text.font);
  return [...new Set(fonts)];
}
