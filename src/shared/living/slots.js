// "Slots": every numeric parameter of a clip that a hand (mouse, pad, later MIDI) can steer, described uniformly.
//   { id, label, owner, key, def, setBase(v), start }
// owner is the object that holds keyframes{} (the clip, one of its effects, or its generator data) so a take writes them in the one
// place the rest of the editor already reads. `start` is the clip's start on the timeline, to turn timeline time into clip time.
import { EFFECTS, WET } from '../effects-defs.js';
import { CLIP_PROPS } from '../params.js';
import { GEN_PARAMS } from '../organic-defs.js';

const numeric = (d) => !d.options && d.kind !== 'color';

export function paramSlots(clip) {
  if (!clip) return [];
  const out = [];
  for (const d of CLIP_PROPS) out.push({ id: `clip.${d.key}`, label: `Clip · ${d.label}`, owner: clip, key: d.key, def: d, setBase: (v) => { clip.props[d.key] = v; }, start: clip.start });
  if (clip.type === 'generator' && clip.gen) {
    for (const d of GEN_PARAMS.filter(numeric)) out.push({ id: `gen.${d.key}`, label: `Generator · ${d.label}`, owner: clip.gen, key: d.key, def: d, setBase: (v) => { clip.gen.params[d.key] = v; }, start: clip.start });
  }
  (clip.effects || []).forEach((fx, i) => {
    const def = EFFECTS[fx.type];
    if (!def) return;
    for (const d of [...def.params.filter(numeric), WET]) {
      const wet = d === WET;
      out.push({ id: `fx${i}.${d.key}`, label: `${def.label.split(' (')[0]} · ${d.label}`, owner: fx, key: d.key, def: d, start: clip.start,
        setBase: wet ? (v) => { if (v >= 1) delete fx.wet; else fx.wet = v; } : (v) => { fx.params[d.key] = v; } });
    }
  });
  return out;
}

export const findSlot = (clip, id) => paramSlots(clip).find((s) => s.id === id) || null;
