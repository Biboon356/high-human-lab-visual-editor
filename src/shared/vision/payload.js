// Exactly what the online AI is sent, built in one place so the editor can show it BEFORE anything leaves the computer.
// The sentence, the look being refined (effect names and numbers only), the names of the effects already on the selected clip, and the public
// catalogue of effects with their safe ranges. Never video, pictures, audio, file names or paths.
import { catalogue } from './plan.js';

export const clean = (s, n) => String(s ?? '').slice(0, n);

export function buildPayload({ text, current, clipEffects } = {}) {
  const payload = { request: clean(text, 600), catalogue: catalogue() };
  if (current && Array.isArray(current.effects)) {
    payload.current = { title: clean(current.title, 80), effects: current.effects.slice(0, 8).map((e) => ({ type: clean(e.type, 30), params: Object.fromEntries(Object.entries(e.params || {}).filter(([, v]) => typeof v === 'number').slice(0, 12)) })) };
  }
  if (Array.isArray(clipEffects) && clipEffects.length) payload.alreadyOnClip = clipEffects.slice(0, 12).map((t) => clean(t, 30));
  return payload;
}
