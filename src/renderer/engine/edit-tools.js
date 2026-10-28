// Basic editing tools that need a derived media file: reverse a clip, freeze a frame.
// Both make an ordinary media item (a reversed file / a still PNG) and point clips at it, so preview, export and save all just work.
import { store } from '../store.js';
import { toast } from '../ui/dom.js';
import { findMedia, uid } from '/shared/project.js';
import { clipEnd, freezeFrameAt, sourceSpan, sourceTimeAt } from '/shared/timeline.js';

async function importDerived(path, name) {
  const [r] = await window.hh.probePaths([path]);
  if (!r?.ok) throw new Error(r?.error || 'Could not read the generated file.');
  return { id: uid('med'), ...r.info, name };
}

/** Plays the selected clip backwards (picture and sound). One undo step. */
export async function reverseSelected() {
  const clip = store.selectedClip;
  const media = clip?.type === 'media' ? findMedia(store.project, clip.mediaId) : null;
  if (!clip || !media || media.kind === 'image') { toast('Select a video or audio clip to reverse.', 'error'); return false; }
  if (media.missing) { toast(`"${media.name}" is missing — relink it first.`, 'error'); return false; }
  const { start, duration } = sourceSpan(clip);
  toast(`Reversing ${duration.toFixed(1)} s… this renders a new file, long clips take a moment.`);
  try {
    const dest = await window.hh.reverseRange({ path: media.path, start, duration, hasVideo: media.kind === 'video', hasAudio: !!media.hasAudio || media.kind === 'audio', fps: Math.round(media.fps || 30), width: media.width || 1920, height: media.height || 1080 });
    const rev = await importDerived(dest, `${media.name.replace(/\.[^.]+$/, '')} (reversed)`);
    store.snapshot();
    store.project.media.push(rev);
    clip.mediaId = rev.id; clip.in = 0; clip.name = `${clip.name || media.name} ◄`;
    store.touch('project');
    toast('Reversed. Undo brings the original back.');
    return true;
  } catch (e) { toast(`Reverse failed: ${e.message}`, 'error'); return false; }
}

/** Holds the frame under the playhead for `seconds`, pushing the rest of that track later. One undo step. */
export async function freezeAtPlayhead(seconds = 2) {
  const t = store.playhead;
  const sel = store.selectedClip;
  const isVideo = (c) => c?.type === 'media' && findMedia(store.project, c.mediaId)?.kind === 'video';
  const clip = isVideo(sel) && t > sel.start && t < clipEnd(sel) ? sel
    : store.project.clips.filter((c) => isVideo(c) && t > c.start && t < clipEnd(c)).sort((a, b) => store.project.tracks.findIndex((x) => x.id === a.trackId) - store.project.tracks.findIndex((x) => x.id === b.trackId))[0];
  if (!clip) { toast('Park the playhead inside a video clip to freeze its frame.', 'error'); return false; }
  const media = findMedia(store.project, clip.mediaId);
  try {
    const dest = await window.hh.extractFrame({ path: media.path, time: sourceTimeAt(clip, t) });
    const still = await importDerived(dest, `Freeze · ${media.name.replace(/\.[^.]+$/, '')} @${t.toFixed(2)}s`);
    store.snapshot();
    store.project.media.push(still);
    const r = freezeFrameAt(store.project, clip.id, t, seconds, still.id);
    if (!r) { store.undoStack.pop(); store.project.media.pop(); toast('Could not freeze here.', 'error'); return false; }
    store.touch('project');
    store.select(r.freeze.id);
    return true;
  } catch (e) { toast(`Freeze failed: ${e.message}`, 'error'); return false; }
}
