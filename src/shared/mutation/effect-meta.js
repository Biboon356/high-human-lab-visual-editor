// What the Mutation Engine needs to know about each effect beyond its parameter list (which stays in shared/effects-defs.js, the single
// source of truth for keys, hard ranges and defaults). This file only adds judgement:
//   category / tags  what the effect is, for choosing and for the future Creative Director
//   stage            where it belongs in a chain ('alpha' and 'ui' are pinned to the end, see chain.js)
//   cost             light | medium | heavy — ESTIMATED from the shader (taps, loops, size), not measured on a GPU
//   alpha            'writes' when the effect changes transparency (it should not run before an effect that expects a full picture)
//   exclusive        effects in one group are not stacked by a random roll (they do the same job and mud each other)
//   addable          false = never inserted by a random roll (needs a deliberate setup: a crop, a mask …)
//   params           per-parameter overrides: { range: [lo, hi] } a safer window than the slider's hard range,
//                    { fixed: true } never randomised, { allow: [..] } the option indices a roll may choose
// Hard limits always still apply; a safe range can only be narrower. test/mutation.test.mjs enforces all of this against EFFECTS.
import { EFFECTS } from '../effects-defs.js';

export const CATEGORIES = ['distort', 'analog', 'camera', 'print', 'colour', 'organic', 'pattern', 'scene', 'alpha'];
export const STAGES = { warp: 10, tone: 20, stylize: 30, light: 40, camera: 50, overlay: 60, alpha: 70, ui: 80 };
export const PINNED_END = new Set(['alpha', 'ui']);
export const COSTS = ['light', 'medium', 'heavy'];

const m = (category, stage, cost, tags, extra = {}, params = {}) => ({ category, stage, cost, tags, alpha: 'keep', addable: true, ...extra, params });
const r = (lo, hi) => ({ range: [lo, hi] });
const FIX = { fixed: true };

export const EFFECT_META = {
  glitch: m('distort', 'warp', 'light', ['glitch', 'digital', 'broken'], {}, { amount: r(0.1, 0.8), blocks: r(0.02, 0.2), split: r(0, 0.04), rate: r(3, 24) }),
  grain: m('analog', 'camera', 'light', ['grain', 'film', 'noise'], {}, { amount: r(0.05, 0.6), size: r(0.8, 3.5), color: r(0, 0.6) }),
  noise: m('organic', 'overlay', 'light', ['cloud', 'haze', 'green'], {}, { amount: r(0.1, 0.7), scale: r(1, 10), speed: r(0, 1.5), green: r(0, 0.7) }),
  distort: m('distort', 'warp', 'light', ['wave', 'warp', 'liquid'], {}, { amount: r(0.002, 0.08), freq: r(2, 20), speed: r(0, 4) }),
  fluid: m('organic', 'warp', 'light', ['liquid', 'warp', 'organic'], {}, { amount: r(0.01, 0.2), scale: r(0.8, 5), speed: r(0, 1) }),
  blur: m('camera', 'stylize', 'medium', ['blur', 'soft', 'dream'], {}, { radius: r(1, 30) }),
  color: m('colour', 'tone', 'light', ['colour', 'grade', 'tone'], {}, { brightness: r(-0.25, 0.25), contrast: r(0.7, 1.6), saturation: r(0.3, 1.8), hue: r(-60, 60), tint: r(0, 0.7), levels: r(6, 32), invert: FIX }),
  chroma: m('camera', 'camera', 'medium', ['lens', 'rgb', 'aberration'], {}, { amount: r(0.002, 0.03) }),
  bloom: m('camera', 'light', 'medium', ['glow', 'bloom', 'dream', 'y2k'], {}, { threshold: r(0.3, 0.85), intensity: r(0.2, 1.2), radius: r(10, 80) }),
  glints: m('camera', 'light', 'medium', ['sparkle', 'star', 'y2k', 'lens'], {}, { threshold: r(0.5, 0.95), length: r(40, 320), intensity: r(0.3, 1.8) }),
  veins: m('organic', 'overlay', 'medium', ['veins', 'roots', 'organic', 'growth'], {}, { growth: FIX, density: r(1, 5), thickness: r(0.06, 0.3), warp: r(0.2, 1.5), flow: r(0, 1.5), glow: r(0.3, 1.4), mix: r(0.5, 1) }),
  dither: m('print', 'stylize', 'medium', ['dither', '1bit', 'handheld', 'retro'], { exclusive: 'binarize' }, { size: r(1, 6), mix: r(0.4, 1) }),
  holo: m('camera', 'light', 'light', ['holo', 'foil', 'iridescent', 'y2k'], {}, { strength: r(0.2, 1.1), scale: r(0.5, 5), warp: r(0, 1.5) }),
  kaleido: m('distort', 'warp', 'light', ['mirror', 'kaleidoscope', 'psychedelic'], {}, { segments: r(3, 12), spin: r(-30, 30), zoom: r(0.6, 2), cx: r(0.3, 0.7), cy: r(0.3, 0.7), mix: r(0.5, 1) }),
  spores: m('organic', 'overlay', 'medium', ['spores', 'particles', 'glow'], {}, { density: r(0.4, 2.5), size: r(0.5, 2), speed: r(0, 1), glow: r(0.3, 2.2) }),
  cells: m('organic', 'overlay', 'medium', ['cells', 'glass', 'membrane'], {}, { scale: r(3, 24), lens: r(0, 1), edge: r(0.01, 0.1), glow: r(0.2, 1.4), mix: r(0.4, 1) }),
  hud: m('camera', 'ui', 'medium', ['hud', 'viewfinder', 'camcorder', 'overlay'], {}, { scale: r(0.7, 1.6), rec: FIX, timecode: FIX, grid: r(0, 0.4), alert: FIX }),
  crop: m('alpha', 'alpha', 'light', ['crop', 'frame', 'letterbox'], { alpha: 'writes', addable: false }, { left: FIX, right: FIX, top: FIX, bottom: FIX, round: FIX, feather: FIX }),
  xerox: m('print', 'stylize', 'light', ['xerox', 'photocopy', 'zine', 'punk'], { exclusive: 'binarize' }, { contrast: r(1.2, 3.5), threshold: r(0.3, 0.7), size: r(3, 10), mix: r(0.5, 1) }),
  fisheye: m('camera', 'warp', 'light', ['fisheye', 'lens', 'skate', 'wide'], {}, { amount: r(-0.2, 1), zoom: r(0.8, 1.4), chroma: r(0, 0.03) }),
  torn: m('print', 'alpha', 'light', ['torn', 'paper', 'zine', 'edge'], { alpha: 'writes' }, { amount: r(0.2, 0.8), rough: r(3, 14), rim: r(0.002, 0.02), shadow: r(0.2, 0.8) }),
  pattern: m('pattern', 'overlay', 'heavy', ['mandala', 'desi', 'pattern', 'ornament'], {}, { scale: r(0.5, 2.5), detail: r(6, 18), speed: r(-0.3, 0.3), line: r(1, 5), glow: r(0.2, 1.2), mix: r(0.4, 1) }),
  object3d: m('scene', 'overlay', 'heavy', ['3d', 'object', 'cube', 'chrome'], { exclusive: 'scene' }, { background: { allow: [0, 1, 2] }, size: r(0.6, 1.6), x: r(-0.4, 0.4), y: r(-0.3, 0.3), sx: r(-60, 60), sy: r(-60, 60), sz: r(-60, 60) }),
  grid3d: m('scene', 'overlay', 'light', ['synthwave', 'grid', 'retro', '80s'], { exclusive: 'scene' }, { horizon: r(0.3, 0.6), scale: r(6, 24), speed: r(-1.5, 1.5), line: r(0.6, 2.5), glow: r(0.4, 2) }),
  film: m('analog', 'camera', 'medium', ['film', '35mm', 'halation', 'grain'], {}, { grain: r(0.1, 0.6), halation: r(0, 0.7), lift: r(0, 0.25), vignette: r(0, 0.7), weave: r(0, 0.6) }),
  vhs: m('analog', 'camera', 'medium', ['vhs', 'tape', 'lofi', 'analog'], {}, { jitter: r(0.05, 0.6), bleed: r(0.002, 0.03), noise: r(0.1, 0.6), tracking: r(0.05, 0.7) }),
  mosh: m('distort', 'warp', 'medium', ['datamosh', 'smear', 'glitch'], {}, { amount: r(0.1, 0.8), block: r(8, 96), hold: r(1, 16), smear: r(0.2, 2.5) }),
  halftone: m('print', 'stylize', 'light', ['halftone', 'dots', 'comic', 'print'], { exclusive: 'binarize' }, { size: r(4, 20), contrast: r(0.8, 2.5), mix: r(0.3, 1) }),
  pixel: m('distort', 'stylize', 'light', ['pixel', 'lowres', '8bit'], {}, { size: r(3, 40), mix: r(0.5, 1) }),
  shake: m('distort', 'warp', 'light', ['shake', 'punch', 'camera'], {}, { amount: r(0.002, 0.04), speed: r(1, 8), zoom: r(1, 1.25), roll: r(0, 5) }),
  flash: m('distort', 'light', 'light', ['flash', 'strobe'], {}, { amount: r(0.1, 1), rate: r(0.5, 8), decay: r(2, 10) }),
  gradmap: m('colour', 'tone', 'light', ['duotone', 'gradient', 'colour', 'grade'], {}, { midpos: r(0.25, 0.75), contrast: r(0.8, 2), mix: r(0.5, 1) }),
  threshold: m('print', 'stylize', 'light', ['threshold', 'xerox', 'bw', 'contrast'], { exclusive: 'binarize' }, { level: r(0.3, 0.7), noise: r(0, 1.2), invert: FIX }),
  solarize: m('colour', 'tone', 'light', ['solarize', 'psychedelic', 'channel'], {}, { hue: r(-90, 90) }),
  slices: m('distort', 'warp', 'light', ['slices', 'cut', 'bars', 'glitch'], {}, { bands: r(4, 40), shift: r(0.01, 0.3), black: r(0, 0.5), rate: r(1, 16) }),
  mask: m('alpha', 'alpha', 'light', ['mask', 'window', 'shape'], { alpha: 'writes', addable: false }, { shape: FIX, x: FIX, y: FIX, size: FIX, aspect: FIX, rotate: FIX, feather: FIX, wobble: FIX, invert: FIX }),
  outline: m('alpha', 'alpha', 'medium', ['sticker', 'outline', 'die-cut'], { alpha: 'writes', addable: false }, { width: r(2, 30) }),
  crt: m('analog', 'camera', 'light', ['crt', 'scanlines', 'broadcast', 'retro'], {}, { scan: r(0.1, 0.8), lines: r(240, 800), bleed: r(0.001, 0.015), curve: r(0, 0.2), flicker: r(0, 0.2) }),
};

export const metaFor = (type) => EFFECT_META[type] || null;
export const isHeavy = (type) => EFFECT_META[type]?.cost === 'heavy';
export const isPinnedEnd = (type) => PINNED_END.has(EFFECT_META[type]?.stage);
export const stageOrder = (type) => STAGES[EFFECT_META[type]?.stage] ?? 0;

/** Effect types a random roll may insert on its own. */
export const addableTypes = () => Object.keys(EFFECTS).filter((t) => EFFECT_META[t]?.addable);

/** The window a roll may move a numeric parameter within: the safe override, else the hard range. */
export function mutationRange(type, def) {
  const o = EFFECT_META[type]?.params?.[def.key]?.range;
  return o ? [Math.max(def.min, o[0]), Math.min(def.max, o[1])] : [def.min, def.max];
}
export const paramOverride = (type, key) => EFFECT_META[type]?.params?.[key] || null;
export const isParamFixed = (type, key) => !!EFFECT_META[type]?.params?.[key]?.fixed;

/** Consistency problems between this file and the effect registry (empty when sound). Used by the test and by a dev console. */
export function checkMeta() {
  const issues = [];
  for (const type of Object.keys(EFFECTS)) {
    const meta = EFFECT_META[type];
    if (!meta) { issues.push(`${type}: no meta`); continue; }
    if (!CATEGORIES.includes(meta.category)) issues.push(`${type}: unknown category ${meta.category}`);
    if (!(meta.stage in STAGES)) issues.push(`${type}: unknown stage ${meta.stage}`);
    if (!COSTS.includes(meta.cost)) issues.push(`${type}: unknown cost ${meta.cost}`);
    if (!meta.tags?.length) issues.push(`${type}: no tags`);
    for (const [key, o] of Object.entries(meta.params)) {
      const def = EFFECTS[type].params.find((d) => d.key === key);
      if (!def) { issues.push(`${type}.${key}: no such parameter`); continue; }
      if (o.range) {
        if (def.kind === 'color' || def.options || def.toggle) issues.push(`${type}.${key}: a range only makes sense for a numeric parameter`);
        else if (!(o.range[0] < o.range[1]) || o.range[0] < def.min || o.range[1] > def.max) issues.push(`${type}.${key}: range ${o.range} is not inside ${def.min}..${def.max}`);
        else if (def.def < o.range[0] || def.def > o.range[1]) issues.push(`${type}.${key}: the default ${def.def} is outside the safe range ${o.range}`);
      }
      if (o.allow && (!def.options || o.allow.some((i) => !Number.isInteger(i) || i < 0 || i >= def.options.length))) issues.push(`${type}.${key}: bad allow list`);
    }
  }
  for (const type of Object.keys(EFFECT_META)) if (!EFFECTS[type]) issues.push(`${type}: meta for an effect that does not exist`);
  return issues;
}
