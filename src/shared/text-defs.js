// Typography Lab definitions: default style, animations, and experimental presets.
import { createClip, defaultProps } from './project.js';
import { createEffect } from './effects-defs.js';

export const FONTS = [
  'DotGothic16', 'Zen Antique', 'Dela Gothic One', 'Michroma', 'Orbitron', 'Press Start 2P', 'UnifrakturCook', 'Pirata One', 'Pinyon Script', 'Instrument Serif', 'Inter Tight', 'DM Mono', 'Helvetica Neue', 'Arial Black', 'Impact', 'Futura', 'Courier New', 'Menlo', 'Consolas',
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
    for (const k of ['x', 'y', 'tracking']) if (side[k] !== undefined) c.props[k] = side[k];
    return c;
  };
  return [build(L.kicker, kicker, 'Kicker'), build(L.title, title, 'Title')];
}
