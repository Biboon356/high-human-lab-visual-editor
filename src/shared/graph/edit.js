// Graph editing operations (pure). Each one changes ONE thing on a project (a copy or the real one: the caller wraps it in store.mutate, so it is one Undo step)
// and returns true when it changed something, false when it refused (unknown id, a parameter that cannot follow music, a move that is no move).
// They reuse what already exists: bindings are the same {source, amount} the Inspector's ∿ button makes, and the default strength is Tell it's `baseAmount`.
import { EFFECTS } from '../effects-defs.js';
import { CLIP_PROPS, REACTIVE_SOURCES } from '../params.js';
import { baseAmount } from '../command/parse.js';

const clipOf = (project, clipId) => project?.clips?.find((c) => c.id === clipId) || null;
const fxIndex = (clip, id) => (clip?.effects || []).findIndex((e) => e.id === id);
const numericDef = (type, key) => { const d = EFFECTS[type]?.params.find((p) => p.key === key); return d && !d.kind && !d.toggle && !d.options && Number.isFinite(d.min) && Number.isFinite(d.max) ? d : null; };

/** Can this parameter follow music? (a number with a range: not a colour, a switch or a list). `effectId` null = a property of the clip itself. */
export function bindable(clip, effectId, key) {
  if (!clip) return false;
  if (effectId === null || effectId === 'clip') return CLIP_PROPS.some((d) => d.key === key);
  const fx = (clip.effects || []).find((e) => e.id === effectId);
  return !!fx && (key === 'wet' || !!numericDef(fx.type, key));
}
const ownerOf = (clip, effectId) => (effectId === null || effectId === 'clip' ? clip : (clip.effects || []).find((e) => e.id === effectId) || null);

/** Moves an effect to position `to` (0 = first, runs first). */
export function moveEffect(project, clipId, effectId, to) {
  const clip = clipOf(project, clipId); if (!clip) return false;
  const from = fxIndex(clip, effectId); const n = clip.effects.length;
  if (from < 0 || !Number.isInteger(to) || to < 0 || to >= n || to === from) return false;
  const [fx] = clip.effects.splice(from, 1); clip.effects.splice(to, 0, fx);
  return true;
}
export function setEffectEnabled(project, clipId, effectId, on) {
  const clip = clipOf(project, clipId), i = fxIndex(clip, effectId); if (i < 0) return false;
  if ((clip.effects[i].enabled !== false) === !!on) return false;
  clip.effects[i].enabled = !!on; return true;
}
export function removeEffect(project, clipId, effectId) {
  const clip = clipOf(project, clipId), i = fxIndex(clip, effectId); if (i < 0) return false;
  clip.effects.splice(i, 1); return true;
}
/** Makes a parameter follow a signal. A parameter that already follows one is re-pointed (strength kept unless `amount` is given). */
export function bindParam(project, clipId, effectId, key, source, amount) {
  const clip = clipOf(project, clipId);
  if (!clip || !REACTIVE_SOURCES.includes(source) || !bindable(clip, effectId, key)) return false;
  const owner = ownerOf(clip, effectId); owner.bindings ||= {};
  const was = owner.bindings[key];
  let a = amount;
  if (a === undefined) a = was ? was.amount : (effectId === null || effectId === 'clip' ? baseAmount({ kind: 'clip', key }) : key === 'wet' ? 0.5 : baseAmount({ kind: 'effect', type: owner.type, key }));
  if (!Number.isFinite(a)) return false;
  a = Math.min(1, Math.max(-1, a));
  if (was && was.source === source && was.amount === a) return false;
  owner.bindings[key] = { source, amount: a }; return true;
}
export function setBindingAmount(project, clipId, effectId, key, amount) {
  const clip = clipOf(project, clipId), owner = clip && ownerOf(clip, effectId), b = owner?.bindings?.[key];
  if (!b || !Number.isFinite(amount)) return false;
  const a = Math.min(1, Math.max(-1, amount)); if (a === b.amount) return false;
  b.amount = a; return true;
}
export function unbindParam(project, clipId, effectId, key) {
  const clip = clipOf(project, clipId), owner = clip && ownerOf(clip, effectId);
  if (!owner?.bindings?.[key]) return false;
  delete owner.bindings[key]; return true;
}
/** Every parameter of an effect (or of the clip) that could follow music, for a menu. */
export function bindableParams(clip, effectId) {
  if (!clip) return [];
  if (effectId === null || effectId === 'clip') return CLIP_PROPS.map((d) => ({ key: d.key, label: d.label }));
  const fx = (clip.effects || []).find((e) => e.id === effectId); if (!fx) return [];
  return [...EFFECTS[fx.type].params.filter((d) => numericDef(fx.type, d.key)).map((d) => ({ key: d.key, label: String(d.label).replace(/ \(.*/, '') })), { key: 'wet', label: 'Wet / dry' }];
}
