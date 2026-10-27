// Typography Lab definitions: default style, animations, and experimental presets.
import { createClip, defaultProps } from './project.js';
import { createEffect } from './effects-defs.js';

export const FONTS = [
  'Helvetica Neue', 'Arial Black', 'Impact', 'Futura', 'Courier New', 'Menlo', 'Consolas',
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
    fx: { split: 0, shadow: 0, glow: 0, gradient: false, grad1: '#ffffff', grad2: '#7d8f85' },
  };
}

const mk = (name, text, props, effects = []) => ({ name, text, props, effects });

export const TEXT_PRESETS = [
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
