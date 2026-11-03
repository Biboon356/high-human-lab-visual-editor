// A "look plan": the one shape that every interpreter (the offline vibe dictionary, the optional online AI) hands to the editor.
// A plan is a title, a sentence and an effect chain. It always goes through the Mutation Engine's own gate (validateChain, composeChain),
// so nothing an interpreter says can put an unknown effect, an out-of-range value or a runaway chain on a clip. Applying a plan only ever
// ADDS effects to the selected clips; the caller shows it first (PREVIEW) and it is one Undo step.
import { EFFECTS } from '../effects-defs.js';
import { REACTIVE_SOURCES } from '../params.js';
import { validateChain, composeChain, chainToEffects, newItem } from '../mutation/chain.js';
import { addableTypes, mutationRange } from '../mutation/effect-meta.js';

export const MAX_PLAN_EFFECTS = 6;
const PRIMARY = ['amount', 'intensity', 'strength', 'growth', 'density', 'radius', 'size'];
const shortLabel = (type) => EFFECTS[type].label.replace(/ \(.*/, '');
const isNumericDef = (d) => !d.kind && !d.toggle && !d.options && Number.isFinite(d.min) && Number.isFinite(d.max);

/** The parameter that "more of this effect" should move. */
export function primaryParam(type) {
  const defs = (EFFECTS[type]?.params || []).filter(isNumericDef);
  return defs.find((d) => d.key === PRIMARY.find((k) => defs.some((x) => x.key === k))) || defs[0] || null;
}

/**
 * @param meta   {title, summary, source}
 * @param items  [{type, params?, wet?, bindings?}] (anything an interpreter produced)
 * @returns {{ok:true, plan, issues, dropped} | {ok:false, reason}}
 */
export function makePlan(meta, items) {
  const ok = new Set(addableTypes());
  const asked = (Array.isArray(items) ? items : []).filter((i) => i && ok.has(i.type));
  const { chain, issues } = validateChain(asked);
  const { chain: ordered, dropped } = composeChain(chain, { maxLength: MAX_PLAN_EFFECTS, maxHeavy: 2 });
  if (!ordered.length) return { ok: false, reason: 'That did not turn into any effect I can use.' };
  return { ok: true, plan: { title: String(meta.title || 'Look').slice(0, 60), summary: String(meta.summary || '').slice(0, 240), source: meta.source || 'offline', chain: ordered }, issues, dropped };
}

/** Adds the plan's effects to each clip (fresh instances). Returns how many clips changed. */
export function applyPlan(project, clipIds, plan) {
  let n = 0;
  for (const id of clipIds) {
    const c = project.clips.find((x) => x.id === id);
    if (!c || !Array.isArray(c.effects)) continue;
    c.effects.push(...chainToEffects(plan.chain));
    n++;
  }
  return n;
}

/** Human lines for a plan: only what differs from the defaults, plus audio links. */
export function describePlan(plan) {
  return plan.chain.map((it) => {
    const def = EFFECTS[it.type];
    const bits = [];
    for (const d of def.params) {
      if (it.params[d.key] === d.def || it.params[d.key] === undefined) continue;
      const v = it.params[d.key];
      bits.push(`${d.label.replace(/ \(.*/, '')} ${typeof v === 'number' ? +v.toFixed(3) : v}`);
    }
    for (const [k, b] of Object.entries(it.bindings || {})) bits.push(`${def.params.find((d) => d.key === k)?.label || k} ← ${b.source}${b.amount < 0 ? ' (inverted)' : ''}`);
    if (it.wet !== undefined) bits.push(`wet ${Math.round(it.wet * 100)}%`);
    return `${shortLabel(it.type)}${bits.length ? `: ${bits.join(', ')}` : ''}`;
  });
}

/** Plans an interpreter returns can be shown as a chain on one clip. */
export const planSummaryLine = (plan) => describePlan(plan).join(' · ');

/** A compact catalogue of what an interpreter may use (also what is sent to the online AI: names and safe ranges only). */
export function catalogue() {
  return addableTypes().map((type) => ({
    type, label: shortLabel(type),
    params: EFFECTS[type].params.filter((d) => isNumericDef(d)).map((d) => { const [lo, hi] = mutationRange(type, d); return { key: d.key, label: d.label.replace(/ \(.*/, ''), min: lo, max: hi, default: d.def }; }),
  }));
}

/** The JSON shape the online AI must answer in (structured output). Colours stay at their defaults: only numbers cross. */
export const AI_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['candidates', 'notes'],
  properties: {
    notes: { type: 'string', description: 'One short sentence: how the request was understood, or what is unclear.' },
    candidates: {
      type: 'array', description: 'Three different readings of the request: gentle, balanced, bold.',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'summary', 'effects'],
        properties: {
          title: { type: 'string' }, summary: { type: 'string' },
          effects: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['type', 'params', 'links'],
              properties: {
                type: { type: 'string', description: 'An effect type from the catalogue.' },
                params: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'value'], properties: { key: { type: 'string' }, value: { type: 'number' } } } },
                links: { type: 'array', description: 'Optional: make a parameter follow the music.', items: { type: 'object', additionalProperties: false, required: ['key', 'signal', 'amount'], properties: { key: { type: 'string' }, signal: { type: 'string', enum: REACTIVE_SOURCES }, amount: { type: 'number' } } } },
              },
            },
          },
        },
      },
    },
  },
};

/** Turns the AI's answer into plans, every one through the same gate. Bad candidates are skipped, never repaired by guessing. */
export function plansFromAi(raw) {
  const out = [], skipped = [];
  for (const c of Array.isArray(raw?.candidates) ? raw.candidates.slice(0, 3) : []) {
    const items = (Array.isArray(c?.effects) ? c.effects : []).map((e) => ({
      type: e?.type,
      params: Object.fromEntries((Array.isArray(e?.params) ? e.params : []).filter((p) => p && typeof p.key === 'string' && Number.isFinite(p.value)).map((p) => [p.key, p.value])),
      bindings: Object.fromEntries((Array.isArray(e?.links) ? e.links : []).filter((l) => l && typeof l.key === 'string').map((l) => [l.key, { source: l.signal, amount: l.amount }])),
    }));
    const r = makePlan({ title: c?.title, summary: c?.summary, source: 'ai' }, items);
    if (r.ok) out.push(r.plan); else skipped.push(r.reason);
  }
  return { plans: out, skipped, notes: typeof raw?.notes === 'string' ? raw.notes.slice(0, 240) : '' };
}

export { newItem };
