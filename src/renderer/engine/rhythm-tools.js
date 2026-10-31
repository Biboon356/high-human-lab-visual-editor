// Edit tools that live on the beat: ad-lib pop-ups and the stutter (beat-repeat) cut.
import { store } from '../store.js';
import { toast } from '../ui/dom.js';
import { createTextClip, TEXT_PRESETS } from '/shared/text-defs.js';
import { planAdlibs, DEFAULT_ADLIBS } from '/shared/adlibs.js';
import { addTrack, addClipRaw, stutterAt, clipEnd, activeRange } from '/shared/timeline.js';

export const adlibWordsDefault = () => DEFAULT_ADLIBS.join(', ');

/** Puts a short word on every Nth beat (inside the render range if one is set), all on one new video track. One undo step. */
export function placeAdlibs({ words, every = 4, seed = Date.now() % 9973 } = {}) {
  const beats = store.analysis?.beats;
  if (!beats?.length) { toast('No beats yet — put the song on the timeline and analyse it (Audio-Reactive tab) first.', 'error'); return 0; }
  const range = activeRange(store.project);
  const plan = planAdlibs(beats, { words: typeof words === 'string' ? words.split(/[,\n]/) : words, every, seed, start: range?.in ?? 0, end: range?.out ?? Infinity });
  if (!plan.length) { toast('Nothing to place: no beats in the range, or no words.', 'error'); return 0; }
  const preset = TEXT_PRESETS.find((p) => p.name === 'Ad-lib Pop (marker)');
  const made = store.mutate((p) => {
    const track = addTrack(p, 'video');
    track.name = 'Ad-libs';
    return plan.map((a) => {
      const c = createTextClip(preset, a.t, a.duration);
      c.text.content = a.word; c.name = `Ad-lib · ${a.word}`;
      Object.assign(c.props, { x: a.x, y: a.y, rotation: a.rotation });
      c.trackId = track.id;
      return addClipRaw(p, c);
    });
  });
  store.select(made[0].id);
  toast(`${made.length} ad-libs placed. Select one to change its word, look or position; Undo removes them all.`);
  return made.length;
}

/** Beat-repeat at the playhead on the clip under it (selected clip first). */
export function stutterAtPlayhead(slice = 0.25, repeats = 4) {
  const t = store.playhead, sel = store.selectedClip;
  const ok = (c) => c?.type === 'media' && t >= c.start && t + slice <= clipEnd(c) + 1e-6;
  const clip = ok(sel) ? sel : store.project.clips.find(ok);
  if (!clip) { toast('Park the playhead inside a clip with at least one slice of footage after it.', 'error'); return false; }
  const r = store.mutate((p) => stutterAt(p, clip.id, t, slice, repeats));
  if (!r) { store.undoStack.pop(); toast('Could not stutter here.', 'error'); return false; }
  store.select(r.parts[0].id);
  return true;
}
