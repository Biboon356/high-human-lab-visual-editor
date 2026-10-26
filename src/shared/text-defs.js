// Typography Lab definitions: default style, animations, and experimental presets.
import { createClip, defaultProps } from './project.js';
import { createEffect } from './effects-defs.js';

export const FONTS = [
  'Helvetica Neue', 'Arial Black', 'Impact', 'Futura', 'Courier New', 'Menlo', 'Consolas',
  'Georgia', 'Times New Roman', 'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', 'sans-serif', 'serif', 'monospace',
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
    strokeWidth: 0, // fraction of font size
    strokeColor: '#2f7d4f',
    uppercase: false,
    bg: { enabled: false, color: '#1c4d33', pad: 0.25 },
    anim: { type: 'none', duration: 1, speed: 1 },
  };
}

const mk = (name, text, props, effects = []) => ({ name, text, props, effects });

export const TEXT_PRESETS = [
  mk('Broadcast Lower Third',
    { content: 'LIVE — HIGH HUMAN LAB', font: 'Menlo', weight: 700, size: 0.05, align: 'left', uppercase: true, color: '#ffffff',
      bg: { enabled: true, color: '#1c4d33', pad: 0.45 }, anim: { type: 'slide', duration: 0.6, speed: 1 } },
    { x: -0.3, y: -0.36, tracking: 0.08 }),
  mk('Teletext Page',
    { content: 'P100  ROOT SIGNAL\nCH 04 · NO CARRIER', font: 'Courier New', weight: 700, size: 0.06, align: 'left', color: '#7dff9f',
      bg: { enabled: true, color: '#000000', pad: 0.5 }, anim: { type: 'typewriter', duration: 2.5, speed: 1 } },
    { x: -0.32, y: 0.28, tracking: 0.04 }),
  mk('Glitch Title',
    { content: 'SIGNAL ROT', font: 'Arial Black', weight: 900, size: 0.2, uppercase: true, color: '#ffffff',
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
    { content: 'grow', font: 'Georgia', weight: 400, italic: true, size: 0.28, color: '#e9fff0',
      anim: { type: 'flicker', duration: 1, speed: 1 } },
    { tracking: 0.02 }, [createEffect('fluid', { amount: 0.03 })]),
  mk('Pulse Mono',
    { content: 'BPM', font: 'Courier New', weight: 700, size: 0.18, color: '#ffffff', anim: { type: 'pulse', duration: 1, speed: 1 } },
    {}),
];

export function createTextClip(preset, start, duration = 4) {
  const base = defaultText();
  const t = preset?.text || {};
  const text = { ...base, ...t, bg: { ...base.bg, ...(t.bg || {}) }, anim: { ...base.anim, ...(t.anim || {}) } };
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
