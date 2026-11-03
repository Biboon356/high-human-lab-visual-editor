// The offline interpreter: a dictionary of "looks in words" (Thai and English) mapped onto the effects the editor already has.
// It is deliberately small and honest: it only knows the words below, says which ones it found, and offers THREE readings (gentle,
// balanced, bold) because one phrase can mean several things. A phrase with no known word gets a clear "I don't know these words", never a guess.
// Fragments name their parameters as [low, high] windows (all inside the Mutation Engine's safe ranges); intensity picks a spot in the window.
import { EFFECTS } from '../effects-defs.js';
import { mutationRange } from '../mutation/effect-meta.js';
import { EFFECT_ALIASES } from '../command/parse.js';
import { makePlan, primaryParam } from './plan.js';
import { newItem } from '../mutation/chain.js';

const fx = (type, p = {}, b = null) => ({ type, p, b });
const WARM = { shadow: '#2a0a00', mid: '#d8601a', high: '#ffe2a0' };
const COOL = { shadow: '#001428', mid: '#2a6fb0', high: '#d8f0ff' };
const NEON = { shadow: '#14002a', mid: '#a000ff', high: '#00ffe1' };

export const VIBES = [
  { id: 'dream', name: 'Dream', words: ['ฝัน', 'ละเมอ', 'dream', 'dreamy', 'ethereal', 'ฟุ้ง'], fx: [fx('blur', { radius: [4, 16] }), fx('bloom', { threshold: 0.55, intensity: [0.3, 0.9], radius: [30, 70] }), fx('color', { saturation: [1.05, 1.35], brightness: [0.02, 0.1] })] },
  { id: 'soft', name: 'Soft', words: ['นุ่ม', 'soft', 'gentle glow'], fx: [fx('bloom', { intensity: [0.2, 0.5], radius: [20, 50] }), fx('blur', { radius: [2, 6] })] },
  { id: 'vintage', name: 'Vintage', words: ['เก่า', 'วินเทจ', 'ย้อนยุค', 'vintage', 'retro', 'old', 'nostalgic', 'nostalgia', 'คิดถึง'], fx: [fx('film', { grain: [0.25, 0.6], halation: [0.2, 0.6], vignette: [0.2, 0.5] }), fx('color', { saturation: [0.9, 0.7], contrast: [1.05, 1.2] })] },
  { id: 'tape', name: 'Tape', words: ['เทป', 'วีเอชเอส', 'vhs', 'tape', 'camcorder', 'กล้องวิดีโอ'], fx: [fx('vhs', { tracking: [0.25, 0.7] }), fx('chroma', { amount: [0.004, 0.014] }), fx('color', { saturation: [1.1, 1.3] })] },
  { id: 'warm', name: 'Warm', words: ['ร้อน', 'อบอุ่น', 'ส้ม', 'แดด', 'พระอาทิตย์', 'warm', 'hot', 'sunset', 'golden', 'summer', 'ฤดูร้อน'], fx: [fx('gradmap', { ...WARM, contrast: [1.0, 1.3], mix: [0.3, 0.7] }), fx('bloom', { threshold: 0.6, intensity: [0.2, 0.6], radius: [30, 60] })] },
  { id: 'cool', name: 'Cool', words: ['เย็น', 'หนาว', 'ฟ้า', 'น้ำแข็ง', 'cool', 'cold', 'icy', 'blue', 'winter'], fx: [fx('gradmap', { ...COOL, contrast: [1.0, 1.3], mix: [0.3, 0.7] }), fx('color', { saturation: [0.85, 0.65] })] },
  { id: 'dark', name: 'Dark', words: ['มืด', 'หม่น', 'เศร้า', 'dark', 'moody', 'gloomy', 'sad', 'night', 'กลางคืน'], fx: [fx('color', { brightness: [-0.03, -0.12], contrast: [1.1, 1.35], saturation: [0.85, 0.55] }), fx('film', { vignette: [0.3, 0.6], grain: [0.15, 0.35] })] },
  { id: 'gritty', name: 'Gritty', words: ['หยาบ', 'ดิบ', 'สตรีท', 'อันเดอร์กราวด์', 'gritty', 'grungy', 'grunge', 'street', 'raw', 'underground', 'dirty'], fx: [fx('grain', { amount: [0.35, 0.6], size: [1.5, 3] }), fx('color', { contrast: [1.2, 1.5], saturation: [0.8, 0.5] }), fx('chroma', { amount: [0.003, 0.012] })] },
  { id: 'glitch', name: 'Glitch', words: ['พัง', 'เสีย', 'ดิจิทัล', 'กลิทช์', 'glitch', 'glitchy', 'broken', 'digital', 'corrupt'], fx: [fx('glitch', { amount: [0.25, 0.6], split: [0.01, 0.03] }), fx('chroma', { amount: [0.004, 0.015] })] },
  { id: 'neon', name: 'Neon', words: ['นีออน', 'ไซเบอร์', 'อนาคต', 'neon', 'cyber', 'cyberpunk', 'futuristic', 'synthwave'], fx: [fx('bloom', { intensity: [0.5, 1.1], radius: [30, 70] }), fx('gradmap', { ...NEON, mix: [0.2, 0.5], contrast: [1.1, 1.4] }), fx('chroma', { amount: [0.006, 0.02] })] },
  { id: 'y2k', name: 'Y2K', words: ['ดิจิแคม', 'ยุค 2000', 'y2k', 'digicam', '2002', 'frutiger'], fx: [fx('bloom', { intensity: [0.3, 0.7], radius: [30, 60] }), fx('glints', { intensity: [0.5, 1.2] }), fx('color', { saturation: [1.2, 1.5], brightness: [0.03, 0.1] }), fx('chroma', { amount: [0.004, 0.01] })] },
  { id: 'organic', name: 'Organic', words: ['รากไม้', 'ธรรมชาติ', 'เส้นเลือด', 'มีชีวิต', 'ราก', 'organic', 'roots', 'veins', 'alive', 'living', 'nature'], fx: [fx('veins', { density: [1.5, 3.5], thickness: [0.08, 0.2], glow: [0.5, 1.1], mix: [0.6, 1] }), fx('fluid', { amount: [0.02, 0.08] })] },
  { id: 'comic', name: 'Comic', words: ['การ์ตูน', 'ป๊อป', 'comic', 'halftone', 'pop art', 'pop'], fx: [fx('halftone', { size: [6, 11], contrast: [1.3, 1.7], mix: [0.4, 1] }), fx('color', { saturation: [1.2, 1.6], contrast: [1.15, 1.4] })] },
  { id: 'xerox', name: 'Xerox', words: ['ซีร็อกซ์', 'ถ่ายเอกสาร', 'ซีน', 'xerox', 'zine', 'photocopy', 'flyer'], fx: [fx('color', { saturation: 0, contrast: [1.4, 1.8] }), fx('threshold', { level: [0.42, 0.55], soft: [0.2, 0.4], noise: [0.5, 1] }), fx('grain', { amount: [0.25, 0.45], color: 0 })] },
  { id: 'film', name: 'Film', words: ['ฟิล์ม', 'ภาพยนตร์', 'หนัง', 'film', 'cinematic', 'cinema', '35mm'], fx: [fx('film', { grain: [0.2, 0.45], halation: [0.3, 0.7], vignette: [0.2, 0.45] }), fx('color', { contrast: [1.05, 1.2], saturation: [1.05, 0.85] })] },
  { id: 'noir', name: 'Noir', words: ['ขาวดำ', 'โมโน', 'noir', 'black and white', 'b&w', 'monochrome', 'mono'], fx: [fx('color', { saturation: 0, contrast: [1.2, 1.6] }), fx('film', { grain: [0.2, 0.45], vignette: [0.25, 0.5] })] },
  { id: 'fog', name: 'Fog', words: ['หมอก', 'มัว', 'fog', 'foggy', 'haze', 'hazy', 'misty'], fx: [fx('noise', { amount: [0.2, 0.5], green: [0, 0.1], speed: [0.1, 0.4] }), fx('blur', { radius: [3, 9] }), fx('color', { brightness: [0.02, 0.08], saturation: [0.9, 0.7] })] },
  { id: 'sparkle', name: 'Sparkle', words: ['ประกาย', 'แวววาว', 'ระยิบ', 'sparkle', 'sparkly', 'glitter', 'shimmer', 'shiny'], fx: [fx('glints', { intensity: [0.6, 1.6] }), fx('bloom', { intensity: [0.2, 0.6], radius: [25, 55] })] },
  { id: 'pulse', name: 'Beat pulse', words: ['ตามจังหวะ', 'เต้นตามเพลง', 'pulse', 'on the beat', 'beat reactive', 'pumping'], fx: [fx('shake', { amount: [0.003, 0.008], zoom: [1.04, 1.1] }, { amount: { source: 'beat', amount: [0.3, 0.6] } }), fx('chroma', { amount: [0.003, 0.008] }, { amount: { source: 'beat', amount: [0.3, 0.6] } })] },
];

const MORE_WORDS = ['เยอะ', 'มากๆ', 'จัด', 'แรงๆ', 'strong', 'heavy', 'intense', 'extreme', 'very'];
const LESS_WORDS = ['นิดๆ', 'เบาๆ', 'บางๆ', 'นิดเดียว', 'subtle', 'light', 'slight', 'barely', 'a little'];
const isLatin = (w) => /^[a-z0-9 &]+$/.test(w);
function findWord(s, w) {
  if (!isLatin(w)) return s.indexOf(w);
  const m = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`).exec(s);
  return m ? m.index + m[1].length : -1;
}
const at = (range, t) => (Array.isArray(range) ? range[0] + (range[1] - range[0]) * t : range);

/** Which dictionary entries a phrase mentions, in the order they were said (longest word wins where words overlap). */
export function findVibes(text) {
  const s = String(text ?? '').toLowerCase().replace(/\s+/g, ' ');
  const hits = [];
  const used = new Array(s.length).fill(false);
  const all = VIBES.flatMap((v) => v.words.map((w) => [w, v])).sort((a, b) => b[0].length - a[0].length);
  for (const [w, v] of all) {
    const i = findWord(s, w);
    if (i < 0 || used.slice(i, i + w.length).some(Boolean)) continue;
    for (let k = i; k < i + w.length; k++) used[k] = true;
    if (!hits.some((h) => h.vibe.id === v.id)) hits.push({ vibe: v, word: w, index: i });
  }
  return hits.sort((a, b) => a.index - b.index);
}

function chainAt(hits, t) {
  const items = [];
  for (const { vibe } of hits) {
    for (const f of vibe.fx) {
      const params = {};
      for (const [k, v] of Object.entries(f.p)) params[k] = at(v, t);
      const bindings = f.b ? Object.fromEntries(Object.entries(f.b).map(([k, b]) => [k, { source: b.source, amount: at(b.amount, t) }])) : {};
      const prev = items.find((i) => i.type === f.type);
      if (prev) { for (const [k, v] of Object.entries(params)) if (!(k in prev.params)) prev.params[k] = v; for (const [k, b] of Object.entries(bindings)) if (!(k in prev.bindings)) prev.bindings[k] = b; } // same effect from two words: the first word's values stand, the second fills the gaps
      else items.push({ type: f.type, params, bindings });
    }
  }
  return items;
}

/**
 * @returns {{ok:true, plans:object[], found:string[], notes:string[]} | {ok:false, reason:string}}
 */
export function interpretVision(text) {
  const s = String(text ?? '').toLowerCase();
  if (!s.trim()) return { ok: false, reason: 'Describe the look you have in mind, for example "dreamy warm afternoon, a bit like old film".' };
  const hits = findVibes(s);
  if (!hits.length) return { ok: false, reason: 'I do not know these words yet (offline I know about 20 moods such as dream, vintage, warm, cold, dark, gritty, glitch, neon, Y2K, film, fog, sparkle). Try other words, or turn on the online AI under "AI (optional)".' };
  const shift = MORE_WORDS.some((w) => findWord(s, w) >= 0) ? 0.15 : LESS_WORDS.some((w) => findWord(s, w) >= 0) ? -0.15 : 0;
  const names = hits.map((h) => h.vibe.name);
  const plans = [];
  for (const [label, t0] of [['Gentle', 0.25], ['Balanced', 0.55], ['Bold', 0.9]]) {
    const t = Math.min(1, Math.max(0, t0 + shift));
    const r = makePlan({ title: `${names.join(' + ')} · ${label}`, summary: `${label} reading of "${text.trim().slice(0, 60)}".`, source: 'offline' }, chainAt(hits, t));
    if (r.ok) plans.push(r.plan);
  }
  if (!plans.length) return { ok: false, reason: 'I understood the words but could not build a look from them.' };
  return { ok: true, plans, found: hits.map((h) => h.word), notes: [`I recognised: ${hits.map((h) => `"${h.word}"`).join(', ')}.`, 'Three readings: the same idea at different strengths.'] };
}

// ---- refining a plan with a short sentence ("more grain", "less glitch", "add bloom", "remove blur") ----
const MORE = ['เพิ่ม', 'มากขึ้น', 'เยอะขึ้น', 'เยอะกว่า', 'แรงขึ้น', 'จัดขึ้น', 'more', 'stronger', 'increase', 'higher'];
const LESS = ['ลด', 'น้อยลง', 'เบาลง', 'น้อยกว่า', 'เบากว่า', 'less', 'weaker', 'reduce', 'decrease', 'lower', 'softer'];
const REMOVE = ['เอาออก', 'ไม่เอา', 'ตัด', 'remove', 'without', 'drop', 'delete', 'no more'];
const ADD = ['ใส่', 'add', 'with'];
const STEP = 0.25;

function effectsIn(text) {
  const s = text.toLowerCase();
  const list = [];
  for (const type of Object.keys(EFFECTS)) for (const w of [type, ...(EFFECT_ALIASES[type] || [])]) list.push([w, type]);
  list.sort((a, b) => b[0].length - a[0].length);
  const found = [], used = new Array(s.length).fill(false);
  for (const [w, type] of list) {
    const i = findWord(s, w);
    if (i < 0 || used.slice(i, i + w.length).some(Boolean)) continue;
    for (let k = i; k < i + w.length; k++) used[k] = true;
    if (!found.includes(type)) found.push(type);
  }
  return found;
}

/** @returns {{ok:true, plan, changes:string[]} | {ok:false, reason}} */
export function refinePlan(plan, text) {
  const s = String(text ?? '').toLowerCase();
  if (!s.trim()) return { ok: false, reason: 'Say what to change, for example "more grain", "less glitch", "add bloom", "remove blur".' };
  const has = (list) => list.some((w) => findWord(s, w) >= 0);
  const remove = has(REMOVE), less = !remove && has(LESS), more = !remove && !less && has(MORE), add = !remove && !less && has(ADD);
  const everything = ['ทั้งหมด', 'ทุกอย่าง', 'overall', 'everything', 'all of it', 'the whole'].some((w) => findWord(s, w) >= 0);
  const types = effectsIn(s);
  if (!(remove || less || more || add)) return { ok: false, reason: 'I could not tell what to change. Try "more …", "less …", "add …" or "remove …" with an effect name (grain, glitch, bloom, blur, VHS, …).' };
  if (!types.length && !everything) return { ok: false, reason: 'Which effect? Name one of them (grain, glitch, bloom, blur, VHS, …) or say "overall".' };
  const chain = structuredClone(plan.chain), changes = [];
  const label = (t) => EFFECTS[t].label.replace(/ \(.*/, '');
  const nudge = (item, dir) => {
    const d = primaryParam(item.type); if (!d) return false;
    const [lo, hi] = mutationRange(item.type, d);
    const cur = item.params[d.key] ?? d.def;
    const next = Math.min(hi, Math.max(lo, cur + dir * STEP * (hi - lo)));
    if (next === cur) return false;
    item.params[d.key] = next; changes.push(`${label(item.type)} ${d.label.replace(/ \(.*/, '')}: ${dir > 0 ? 'up' : 'down'}`);
    return true;
  };
  const targets = everything && !types.length ? chain.map((c) => c.type) : types;
  let out = chain;
  for (const type of targets) {
    const i = out.findIndex((c) => c.type === type);
    if (remove) { if (i >= 0 && out.length > 1) { out = out.filter((c) => c.type !== type); changes.push(`${label(type)}: removed`); } else if (i >= 0) changes.push(`${label(type)}: kept (it is the last effect)`); }
    else if (i >= 0 && (more || less)) nudge(out[i], more ? 1 : -1);
    else if (i >= 0 && add) changes.push(`${label(type)}: already there (say "more ${label(type).toLowerCase()}")`);
    else if (i < 0 && (add || more)) { const it = newItem(type); const d = primaryParam(type); if (d) { const [lo, hi] = mutationRange(type, d); it.params[d.key] = lo + (hi - lo) * 0.5; } out.push(it); changes.push(`${label(type)}: added`); }
    else if (i < 0) changes.push(`${label(type)}: not in this look`);
  }
  const moved = changes.some((c) => !/not in this look|already there|kept/.test(c));
  if (!moved) return { ok: false, reason: changes.join('; ') || 'Nothing to change.' };
  const r = makePlan({ title: plan.title, summary: plan.summary, source: plan.source }, out);
  return r.ok ? { ok: true, plan: r.plan, changes } : { ok: false, reason: r.reason };
}
