// TikTok-style caption looks. Each style is a text-clip template; createCaptionClip fills in a planned caption card.
import { createClip, defaultProps } from './project.js';

export const CAPTION_STYLES = {
  pop: {
    label: 'Karaoke Pop',
    note: 'White text, heavy outline, the spoken word lights up acid-green and pops',
    text: { font: 'Sukhumvit Set', weight: 800, size: 0.056, color: '#ffffff', strokeWidth: 0.2, strokeColor: '#000000', lineHeight: 1.18,
      karaoke: { mode: 'color', hl: '#b6ff3b', pop: 1.14, upcoming: 0.92 }, fx: { shadow: 0.7, glow: 0, split: 0 } },
  },
  box: {
    label: 'Box Highlight',
    note: 'The spoken word sits on a forest-green plate',
    text: { font: 'Sukhumvit Set', weight: 800, size: 0.054, color: '#ffffff', strokeWidth: 0.025, strokeColor: '#000000', lineHeight: 1.25,
      karaoke: { mode: 'box', hl: '#ffffff', plate: '#1f7a46', pop: 1.06, upcoming: 1 }, fx: { shadow: 0.6 } },
  },
  clean: {
    label: 'Clean Subtitle',
    note: 'Plain readable subtitles, no word highlight',
    text: { font: 'Sukhumvit Set', weight: 700, size: 0.046, color: '#ffffff', strokeWidth: 0.14, strokeColor: '#000000', lineHeight: 1.2, karaoke: null, fx: { shadow: 0.8 } },
  },
  glitch: {
    label: 'Hollow Glitch',
    note: 'Outline letters with RGB split; the spoken word fills in',
    text: { font: 'Sukhumvit Set', weight: 800, size: 0.052, color: '#ffffff', hollow: true, fillAlpha: 0.08, strokeWidth: 0.045, strokeColor: '#ffffff', lineHeight: 1.2,
      karaoke: { mode: 'color', hl: '#ffffff', pop: 1.1, upcoming: 0.9, fillActive: true }, fx: { split: 0.5, shadow: 0.3 } },
  },
};

/** Where captions sit: centre-low, clear of TikTok's bottom UI (~20%) and right-hand buttons (~15%). */
export const SAFE_ZONE = { bottom: 0.2, right: 0.15, top: 0.1 };
export const CAPTION_Y = -0.14; // fraction of frame height above centre (y is up)

/**
 * @param card  one entry of planCaptions() (times in edited-timeline seconds)
 * @param styleKey key of CAPTION_STYLES
 */
export function createCaptionClip(card, styleKey = 'pop', { trackId = null } = {}) {
  const style = CAPTION_STYLES[styleKey] || CAPTION_STYLES.pop;
  const start = card.start, duration = Math.max(0.1, card.end - card.start);
  const t = style.text;
  return createClip({
    type: 'text',
    trackId,
    name: card.text.replace(/\n/g, ' ').slice(0, 40),
    start,
    duration,
    text: {
      content: card.text, font: t.font, weight: t.weight, italic: false, size: t.size, fit: 0, align: 'center', lineHeight: t.lineHeight,
      color: t.color, hollow: !!t.hollow, fillAlpha: t.fillAlpha ?? 1, strokeWidth: t.strokeWidth, strokeColor: t.strokeColor, uppercase: false,
      bg: { enabled: false, color: '#000000', pad: 0.25 }, anim: { type: style.text.karaoke ? 'karaoke' : 'fade', duration: 0.12, speed: 1 },
      fx: { split: 0, shadow: 0, glow: 0, gradient: false, grad1: '#fff', grad2: '#888', ...(t.fx || {}) },
      // word times are clip-relative so they survive moving/trimming the clip
      karaoke: t.karaoke ? { ...t.karaoke, words: card.words.map((w) => ({ from: w.from, to: w.to, start: w.start - card.start, end: w.end - card.start })) } : null,
    },
    props: { ...defaultProps(), y: CAPTION_Y },
  });
}
