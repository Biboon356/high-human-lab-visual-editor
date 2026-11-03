// Command parser: turns one typed sentence (Thai or English) into audio-reactive bindings on the selected clips.
// Pure: no DOM, no store, no randomness. It does NOT guess freely: it knows a fixed vocabulary (effects, parameters, 5 signals) and says
// what it understood and what it had to assume. The caller shows that, previews the change, and only then applies it (one Undo step).
//   "glitch react to bass"            → Glitch › Intensity ← bass
//   "ให้ grain ตามความดัง"               → Grain › Amount ← rms
//   "กระตุกตามเบสแรงๆ"                 → Shake › Amount ← bass, strong
//   "ปิดการตอบสนองของ glitch"           → remove the binding
import { EFFECTS, createEffect } from '../effects-defs.js';
import { CLIP_PROPS, REACTIVE_SOURCES } from '../params.js';

const SOURCE_WORDS = [ // [word, source]: more specific first; "เสียง" alone is the last resort
  ['เสียงสูง', 'high'], ['ไฮแฮท', 'high'], ['ไฮฮัท', 'high'], ['treble', 'high'], ['high', 'high'], ['highs', 'high'], ['เสียงแหลม', 'high'], ['แหลม', 'high'],
  ['เสียงกลาง', 'mid'], ['เสียงร้อง', 'mid'], ['vocal', 'mid'], ['mid', 'mid'], ['กลาง', 'mid'],
  ['เสียงต่ำ', 'bass'], ['เบส', 'bass'], ['bass', 'bass'], ['กลองใหญ่', 'bass'], ['คิก', 'bass'], ['kick', 'bass'], ['ทุ้ม', 'bass'],
  ['จังหวะ', 'beat'], ['บีท', 'beat'], ['บีต', 'beat'], ['beat', 'beat'], ['กลอง', 'bass'],
  ['ความดัง', 'rms'], ['loudness', 'rms'], ['volume', 'rms'], ['rms', 'rms'], ['amplitude', 'rms'], ['ดนตรี', 'rms'], ['เพลง', 'rms'], ['เสียง', 'rms'], ['music', 'rms'], ['audio', 'rms'], ['sound', 'rms'],
];
const SOURCE_EXPLICIT = new Set(['เสียงสูง', 'ไฮแฮท', 'ไฮฮัท', 'treble', 'high', 'highs', 'เสียงแหลม', 'แหลม', 'เสียงกลาง', 'เสียงร้อง', 'vocal', 'mid', 'กลาง', 'เสียงต่ำ', 'เบส', 'bass', 'กลองใหญ่', 'คิก', 'kick', 'ทุ้ม', 'จังหวะ', 'บีท', 'บีต', 'beat', 'กลอง', 'ความดัง', 'loudness', 'volume', 'rms', 'amplitude']);

export const EFFECT_ALIASES = { // extra words (the effect's own key is always an alias)
  glitch: ['กลิทช์', 'กลิตช์', 'จอแตก', 'จอกระตุก'], grain: ['เกรน', 'เม็ดเกรน'], blur: ['เบลอ', 'ภาพเบลอ'], bloom: ['เรืองแสง', 'บลูม', 'แสงฟุ้ง'],
  glints: ['ประกาย', 'แสงดาว', 'ระยิบ'], shake: ['สั่น', 'กระตุก', 'ช็อก', 'camera shake', 'punch'], flash: ['แฟลช', 'วาบ', 'ไฟกะพริบ'], chroma: ['แยกสี', 'โครมา', 'chromatic'],
  vhs: ['วีเอชเอส', 'เทปเก่า'], film: ['ฟิล์ม', '35mm'], veins: ['เส้นเลือด', 'ราก', 'รากไม้'], spores: ['สปอร์', 'ฝุ่นลอย'], crt: ['ซีอาร์ที', 'จอเก่า', 'ทีวีเก่า'],
  pixel: ['พิกเซล', 'โมเสก', 'pixelate'], halftone: ['ฮาล์ฟโทน'], memory: ['ความทรงจำ', 'เมมโมรี', 'memory bleed'], distort: ['คลื่น', 'บิดเบี้ยว', 'wave'], fluid: ['ของเหลว', 'fluid warp'],
  fisheye: ['ฟิชอาย'], slices: ['ตัดแถบ', 'สไลซ์'], mosh: ['โมช', 'smear'], xerox: ['ซีร็อกซ์', 'ถ่ายเอกสาร', 'photocopy'], kaleido: ['คาไลโด', 'kaleidoscope', 'mirror'], holo: ['โฮโลแกรม', 'foil'],
  color: ['colour', 'สีภาพ'], noise: ['นอยส์', 'cloud noise'], dither: ['ดิเธอร์'], cells: ['เซลล์'], hud: ['viewfinder'], pattern: ['ลาย', 'mandala', 'มันดาลา'], gradmap: ['gradient map', 'duotone'], solarize: ['โซลาไรซ์'],
};
const CLIP_ALIASES = { opacity: ['ความโปร่งใส', 'ความจาง', 'โปร่งแสง', 'opacity', 'alpha'], scale: ['ซูม', 'ขยายภาพ', 'ขนาดภาพ', 'scale', 'zoom'], rotation: ['หมุน', 'rotation', 'rotate'], x: ['ตำแหน่ง x', 'position x'], y: ['ตำแหน่ง y', 'position y'], rotX: ['เอียง', 'tilt'], rotY: ['หันข้าง', 'turn'] };
const PARAM_ALIASES = { amount: ['ปริมาณ', 'ความแรง', 'ความเข้ม'], intensity: ['ความแรง', 'ความเข้ม'], strength: ['ความแรง', 'ความเข้ม'], size: ['ขนาด'], speed: ['ความเร็ว'], rate: ['ความถี่'], radius: ['รัศมี'], zoom: ['ซูม'], brightness: ['ความสว่าง'], contrast: ['คอนทราสต์'], saturation: ['ความอิ่ม', 'สีสด'], hue: ['เปลี่ยนสี', 'ฮิว'], split: ['แยกสี'], mix: ['ผสม'], growth: ['การโต'], density: ['ความหนาแน่น'], glow: ['เรืองแสง'] };

const DEFAULT_SOURCE = { // when the sentence names no signal: the one that usually fits the effect (shown as an assumption)
  shake: 'bass', glitch: 'bass', mosh: 'bass', distort: 'bass', fluid: 'bass', fisheye: 'bass', bloom: 'bass', slices: 'bass', kaleido: 'bass',
  flash: 'beat', glints: 'high', holo: 'high', spores: 'high', chroma: 'high', grain: 'rms', vhs: 'rms', film: 'rms', noise: 'rms', crt: 'rms',
};
const DEFAULT_PARAM = ['amount', 'intensity', 'strength', 'growth', 'density', 'radius', 'size'];
const SIGNAL_NAMES = { rms: 'loudness', bass: 'bass', mid: 'mids', high: 'highs', beat: 'beats' };
const BIND_WORDS = ['ยึดโยง', 'โยงกับ', 'เชื่อมกับ', 'สัมพันธ์กับ', 'สอดคล้องกับ', 'เข้ากับ', 'connect', 'tie', 'couple', 'ตอบสนอง', 'ตาม', 'ผูก', 'ลิงก์', 'ลิ้งค์', 'เต้น', 'ขยับ', 'react', 'bind', 'link', 'sync', 'follow', 'pulse', 'driven', 'to the'];
const UNBIND_WORDS = ['ปิดการตอบสนอง', 'เลิกตอบสนอง', 'เลิกผูก', 'ยกเลิกการผูก', 'ลบการผูก', 'ไม่ต้องตาม', 'unbind', 'stop reacting', 'remove binding', 'remove the binding', 'unlink', 'ปิดการผูก'];
const STRONG = ['แรงๆ', 'มากๆ', 'เยอะๆ', 'แรงมาก', 'จัดๆ', 'จัด', 'strong', 'hard', 'heavy', 'extreme', 'แรง', 'มาก', 'เยอะ'];
const SUBTLE = ['เบาๆ', 'นิดๆ', 'นิดหน่อย', 'เบา', 'นุ่มๆ', 'subtle', 'soft', 'light', 'gentle', 'slight', 'little'];
const INVERT = ['ผกผัน', 'ตรงข้าม', 'กลับด้าน', 'invert', 'inverse', 'opposite', 'duck'];

const has = (s, w) => s.includes(w);
const isLatinWord = (w) => /^[a-z0-9 ]+$/.test(w);
/** Finds `w` in `s`; Latin words must stand alone (so "mid" is not found inside "middle"). Returns the index or -1. */
function find(s, w) {
  if (!isLatinWord(w)) return s.indexOf(w);
  const re = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`);
  const m = re.exec(s);
  return m ? m.index + m[1].length : -1;
}
/** Removes the first occurrence of w (replaced by spaces, so later matches cannot reuse the letters). */
function consume(s, w) { const i = find(s, w); return i < 0 ? s : s.slice(0, i) + ' '.repeat(w.length) + s.slice(i + w.length); }

function numericParams(type) { return EFFECTS[type].params.filter((p) => !p.kind && !p.toggle && Number.isFinite(p.min) && Number.isFinite(p.max)); }

/**
 * @param text     the sentence
 * @param project  current project (only read, for the clip list)
 * @param ctx      {clipIds: string[] (selected clips), hasAnalysis: boolean}
 * @returns {ok:false, reason} | {ok:true, intent:'bind'|'unbind', understood:string[], notes:string[], targets:[{kind,type?,key,label}], apply(project)→boolean}
 */
export function parseCommand(text, project, ctx = {}) {
  const original = String(text ?? '').trim();
  if (!original) return { ok: false, reason: 'Type or say what you want, for example: "glitch react to bass".' };
  let s = original.toLowerCase().replace(/\s+/g, ' ');
  const clipIds = (ctx.clipIds || []).filter((id) => project?.clips?.some((c) => c.id === id));

  const unbind = UNBIND_WORDS.some((w) => find(s, w) >= 0);
  for (const w of UNBIND_WORDS) s = consume(s, w);

  // 1. effects (longest alias first; the matched letters are consumed)
  const aliasList = [];
  for (const type of Object.keys(EFFECTS)) for (const w of [type, ...(EFFECT_ALIASES[type] || [])]) aliasList.push([w, type]);
  aliasList.sort((a, b) => b[0].length - a[0].length);
  const effectTypes = [];
  for (const [w, type] of aliasList) {
    if (find(s, w) < 0) continue;
    s = consume(s, w);
    if (!effectTypes.includes(type)) effectTypes.push(type);
  }

  // 2. the signal (named explicitly, or assumed later)
  let source = null, sourceExplicit = false;
  for (const [w, src] of SOURCE_WORDS) {
    if (find(s, w) < 0) continue;
    if (!source) { source = src; sourceExplicit = SOURCE_EXPLICIT.has(w); }
    s = consume(s, w);
  }

  // 3. parameters of the matched effects, then clip-level properties
  const targets = [];
  for (const type of effectTypes) {
    const params = numericParams(type);
    let chosen = null;
    for (const p of params) {
      const words = [p.key, ...(PARAM_ALIASES[p.key] || [])];
      const w = words.find((x) => find(s, x) >= 0);
      if (w) { chosen = p; s = consume(s, w); break; }
    }
    const assumed = !chosen;
    if (!chosen) chosen = params.find((p) => p.key === DEFAULT_PARAM.find((k) => params.some((q) => q.key === k))) || params[0];
    if (!chosen) continue;
    targets.push({ kind: 'effect', type, key: chosen.key, label: `${EFFECTS[type].label.replace(/ \(.*/, '')} › ${chosen.label}`, assumedParam: assumed });
  }
  if (!effectTypes.length || !targets.length) {
    for (const d of CLIP_PROPS) {
      const w = (CLIP_ALIASES[d.key] || []).find((x) => find(s, x) >= 0);
      if (w) { s = consume(s, w); targets.push({ kind: 'clip', key: d.key, label: `Clip › ${d.label}`, assumedParam: false }); }
    }
  }

  if (!unbind && !source && !BIND_WORDS.some((w) => find(s, w) >= 0) && !/react|ตอบสนอง/.test(original.toLowerCase())) {
    return { ok: false, reason: 'I did not understand that as "make this follow the sound". Try: "glitch react to bass", "grain follow loudness", "ให้ shake ตามจังหวะ".' };
  }
  if (!targets.length) return { ok: false, reason: 'I could not tell what should react. Name an effect (glitch, grain, bloom, shake...) or a clip property (zoom, opacity, rotation).' };
  if (!clipIds.length) return { ok: false, reason: 'Select a clip first (or several), then tell me what should react.' };

  // 4. how much, and which way
  let amount = 0.5, how = '';
  const pct = /(\d{1,3})\s*(%|เปอร์เซ็นต์)/.exec(s);
  if (pct) { amount = Math.min(1, Math.max(0.05, Number(pct[1]) / 100)); how = `${Math.round(amount * 100)}% of the range`; }
  else if (STRONG.some((w) => find(s, w) >= 0)) { amount = 0.85; how = 'strong'; }
  else if (SUBTLE.some((w) => find(s, w) >= 0)) { amount = 0.25; how = 'subtle'; }
  const inverted = INVERT.some((w) => find(s, w) >= 0);
  if (inverted) { amount = -amount; how = `${how ? `${how}, ` : ''}inverted (quieter when the sound is louder)`; }

  const understood = [], notes = [];
  const noteAnalysis = () => { if (!ctx.hasAnalysis) notes.push('The audio is not analyzed yet: I will analyze it so the preview can move.'); };

  if (unbind) {
    understood.push(...targets.map((t) => `Stop ${t.label} from reacting to the sound`));
    const apply = (p) => {
      let n = 0;
      for (const id of clipIds) {
        const c = p.clips.find((x) => x.id === id); if (!c) continue;
        for (const t of targets) {
          const owner = t.kind === 'clip' ? c : (c.effects || []).find((e) => e.type === t.type && e.bindings?.[t.key]);
          if (owner?.bindings?.[t.key]) { delete owner.bindings[t.key]; n++; }
        }
      }
      return n > 0;
    };
    return { ok: true, intent: 'unbind', understood, notes, targets, apply };
  }

  const useSource = (t) => source || (t.kind === 'effect' ? DEFAULT_SOURCE[t.type] : t.key === 'scale' ? 'bass' : 'rms') || 'rms';
  for (const t of targets) {
    const src = useSource(t);
    understood.push(`${t.label} ← ${SIGNAL_NAMES[src]}${how ? `, ${how}` : ''}`);
    if (!sourceExplicit && !source) notes.push(`You did not say which sound, so I picked ${SIGNAL_NAMES[src]} for ${t.label} (my guess).`);
    if (t.assumedParam) notes.push(`You did not name a parameter, so I used ${t.label.split(' › ')[1]} on ${t.label.split(' › ')[0]}.`);
  }
  if (source && !sourceExplicit) notes.push('"sound" is broad, so I used the overall loudness.');
  noteAnalysis();
  const dupNotes = [...new Set(notes)];
  notes.length = 0; notes.push(...dupNotes);

  const apply = (p) => {
    let n = 0;
    for (const id of clipIds) {
      const c = p.clips.find((x) => x.id === id); if (!c) continue;
      for (const t of targets) {
        const src = useSource(t);
        if (!REACTIVE_SOURCES.includes(src)) continue;
        let owner;
        if (t.kind === 'clip') owner = c;
        else {
          c.effects ||= [];
          owner = c.effects.find((e) => e.type === t.type);
          if (!owner) { owner = createEffect(t.type); c.effects.push(owner); }
        }
        owner.bindings ||= {};
        owner.bindings[t.key] = { source: src, amount };
        n++;
      }
    }
    if (n && p.reactive) p.reactive.enabled = true;
    return n > 0;
  };
  return { ok: true, intent: 'bind', understood, notes, targets, apply };
}
