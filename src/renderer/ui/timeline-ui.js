// DOM timeline: ruler, track rows, draggable/trimmable clips, playhead, drag-and-drop from the media bin.
import { el, toast } from './dom.js';
import { runAnalysis } from './reactive-ui.js';
import { visualsFor, drawVisuals } from '../engine/media-cache.js';
import { planMontage } from '/shared/montage.js';
import { EFFECT_PRESETS, instantiatePreset } from '/shared/effects-defs.js';
import { store } from '../store.js';
import { moveClips, deleteClips, overlaps, trackEnd, canPlace, clipEnd, projectDuration, moveClip, trimStart, trimEnd, splitClip, deleteClip, addMediaClip, addTrack, clipKind } from '/shared/timeline.js';
import { findMedia, findTrack, uid } from '/shared/project.js';

const LABEL_W = 118;
const SNAP_PX = 8;

export function mountTimeline() {
  const scroll = document.getElementById('tl-scroll');
  const content = document.getElementById('tl-content');
  const zoomIn = document.getElementById('tl-zoom');
  const snapBox = document.getElementById('tl-snap');
  const beatSnap = document.getElementById('tl-snap-beats');
  let playheadEl = null;

  const px = (t) => t * store.zoom;
  const laneWidth = () => Math.max(scroll.clientWidth - LABEL_W, px(projectDuration(store.project) + 15));

  function render() {
    const { project } = store;
    content.replaceChildren();
    const lw = laneWidth();
    content.style.width = `${lw + LABEL_W}px`;

    // ruler
    const ruler = el('div', { class: 'tl-ruler' }, el('div', { class: 'tl-corner', text: 'TIME' }));
    const rl = el('div', { class: 'tl-ruler-lane', style: `width:${lw}px` });
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const major = steps.find((s) => s * store.zoom >= 70) || 600;
    for (let t = 0; t * store.zoom < lw; t += major) {
      const m = Math.floor(t / 60), s = t % 60;
      rl.append(el('div', { class: 'tick', style: `left:${px(t)}px`, text: `${m}:${String(Math.round(s * 100) / 100).padStart(2, '0')}` }));
    }
    // detected beats (every 4th drawn taller as a "bar")
    store.analysis?.beats.forEach((b, i) => rl.append(el('div', { class: `beat ${i % 4 === 0 ? 'bar' : ''}`, style: `left:${px(b)}px` })));
    ruler.append(rl);
    content.append(ruler);
    rl.addEventListener('pointerdown', (e) => scrub(e, rl));

    // tracks
    for (const track of project.tracks) {
      const lane = el('div', { class: `tl-lane ${track.kind}`, 'data-track': track.id, style: `width:${lw}px` });
      lane.addEventListener('pointerdown', (e) => { if (e.target === lane) { store.select(null); scrub(e, lane); } });
      lane.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('application/x-hh-media')) { e.preventDefault(); lane.classList.add('over'); } });
      lane.addEventListener('dragleave', () => lane.classList.remove('over'));
      lane.addEventListener('drop', (e) => {
        e.preventDefault(); lane.classList.remove('over');
        const id = e.dataTransfer.getData('application/x-hh-media');
        if (!id) return;
        const x = e.clientX - lane.getBoundingClientRect().left;
        const clip = store.mutate((p) => addMediaClip(p, id, track.id, x / store.zoom));
        if (!clip) { import('./dom.js').then((m) => m.toast(`That media can't go on a ${track.kind} track.`, 'error')); return; }
        store.select(clip.id);
      });
      for (const clip of project.clips.filter((c) => c.trackId === track.id)) lane.append(clipEl(clip));

      const label = el('div', { class: 'tl-label' }, el('b', { text: track.name }),
        el('div', {},
          el('button', { class: track.muted ? 'on' : '', text: 'M', title: 'Mute audio on this track', onclick: () => store.mutate(() => { track.muted = !track.muted; }) }),
          track.kind === 'video' ? el('button', { class: track.hidden ? 'on' : '', text: 'H', title: 'Hide this track in the preview and export', onclick: () => store.mutate(() => { track.hidden = !track.hidden; }) }) : null));
      content.append(el('div', { class: 'tl-row' }, label, lane));
    }
    playheadEl = el('div', { class: 'playhead' });
    content.append(playheadEl);
    placePlayhead();
  }

  function clipEl(clip) {
    const media = clip.type === 'media' ? findMedia(store.project, clip.mediaId) : null;
    const kind = clip.type === 'media' ? media?.kind || 'video' : clip.type;
    const fxCount = clip.effects?.length || 0;
    const kfs = [];
    const keyTimes = new Set();
    for (const owner of [clip, clip.gen, ...(clip.effects || [])]) for (const keys of Object.values(owner?.keyframes || {})) for (const k of keys) keyTimes.add(Math.round(k.t * 100) / 100);
    for (const t of keyTimes) kfs.push(el('i', { style: `left:${px(t) - 2}px` }));
    const n = el('div', { class: `clip ${kind} ${store.multi.has(clip.id) ? 'sel' : ''}`, 'data-clip': clip.id, style: `left:${px(clip.start)}px;width:${Math.max(4, px(clip.duration))}px`, title: clip.name },
      el('span', { class: 'nm', text: clip.name || (media?.name ?? clip.type) }),
      fxCount ? el('span', { class: 'badge', text: `fx${fxCount}` }) : null,
      media?.missing ? el('span', { class: 'badge', text: '⚠ missing' }) : null,
      kfs.length ? el('div', { class: 'kfs' }, kfs) : null,
      el('div', { class: 'h l', 'data-h': 'l' }), el('div', { class: 'h r', 'data-h': 'r' }));
    const vis = media && (media.kind === 'video' || media.kind === 'audio') ? visualsFor(media) : null;
    if (vis && (vis.thumbs || vis.peaks)) {
      const cv = el('canvas', { class: 'clip-vis' });
      const scale = Math.min(1, 6000 / Math.max(1, px(clip.duration)));
      cv.width = Math.max(4, Math.round(px(clip.duration) * scale)); cv.height = 38;
      n.prepend(cv);
      drawVisuals(cv, clip, vis, store.zoom);
    }
    n.addEventListener('pointerdown', (e) => beginDrag(e, clip, n));
    return n;
  }

  // ---- interactions
  function scrub(e, lane) {
    const move = (ev) => {
      const x = ev.clientX - lane.getBoundingClientRect().left;
      store.setPlayhead(Math.max(0, x / store.zoom));
    };
    move(e);
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  function snapTargets(excludeId) {
    const ts = [0, store.playhead];
    if (beatSnap.checked && store.analysis) ts.push(...store.analysis.beats);
    for (const c of store.project.clips) if (c.id !== excludeId) ts.push(c.start, clipEnd(c));
    return ts;
  }
  function snap(t, excludeId, also = []) {
    if (!snapBox.checked) return t;
    let best = t, bd = SNAP_PX / store.zoom;
    for (const s of snapTargets(excludeId)) for (const off of [0, ...also]) {
      const d = Math.abs(t + off - s);
      if (d < bd) { bd = d; best = s - off; }
    }
    return best;
  }

  function beginDrag(e, clip, node) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (e.shiftKey || e.metaKey || e.ctrlKey) { store.toggleSelect(clip.id); return; } // build a multi-selection, no drag
    const group = store.multi.has(clip.id) && store.multi.size > 1 && !e.target.dataset.h;
    if (!group) store.select(clip.id); else { store.selection = clip.id; store.emit('selection'); }
    const mode = e.target.dataset.h || 'move';
    const startX = e.clientX;
    const orig = { start: clip.start, duration: clip.duration, in: clip.in, trackId: clip.trackId };
    let snapped = false;
    const ensure = () => { if (!snapped) { store.snapshot(); snapped = true; } };
    const move = (ev) => {
      const dt = (ev.clientX - startX) / store.zoom;
      if (Math.abs(ev.clientX - startX) < 3 && !snapped) return;
      ensure();
      if (mode === 'move' && group) {
        // move the whole selection together on its own tracks; snapping follows the clip being dragged
        moveClips(store.project, [...store.multi], snap(orig.start + dt, clip.id, [clip.duration]) - clip.start);
      } else if (mode === 'move') {
        const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.tl-lane');
        const trackId = target?.dataset.track || clip.trackId;
        let s = snap(orig.start + dt, clip.id, [clip.duration]);
        s = Math.max(0, s);
        // keep last valid position if the new one would overlap or mismatch the track kind
        moveClip(store.project, clip.id, s, trackId);
      } else if (mode === 'l') {
        trimStart(store.project, clip.id, snap(orig.start + dt, clip.id));
      } else {
        trimEnd(store.project, clip.id, snap(orig.start + orig.duration + dt, clip.id));
      }
      store.touch('project');
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  function placePlayhead() {
    if (!playheadEl) return;
    playheadEl.style.left = `${LABEL_W + px(store.playhead)}px`;
  }
  function followPlayhead() {
    const x = LABEL_W + px(store.playhead);
    if (store.playing && (x > scroll.scrollLeft + scroll.clientWidth - 40 || x < scroll.scrollLeft + LABEL_W)) scroll.scrollLeft = Math.max(0, x - LABEL_W - 40);
  }

  // ---- toolbar
  const setZoom = (z) => {
    const anchor = store.playhead;
    const before = LABEL_W + px(anchor) - scroll.scrollLeft;
    store.zoom = Math.min(400, Math.max(10, z));
    zoomIn.value = store.zoom;
    render();
    scroll.scrollLeft = LABEL_W + px(anchor) - before;
  };
  zoomIn.addEventListener('input', () => setZoom(Number(zoomIn.value)));
  document.getElementById('tl-zoom-in').onclick = () => setZoom(store.zoom * 1.25);
  document.getElementById('tl-zoom-out').onclick = () => setZoom(store.zoom / 1.25);
  document.getElementById('tl-fit').onclick = () => {
    const d = Math.max(1, projectDuration(store.project));
    setZoom((scroll.clientWidth - LABEL_W - 40) / d);
    scroll.scrollLeft = 0;
  };
  document.getElementById('tl-add-v').onclick = () => store.mutate((p) => addTrack(p, 'video'));
  document.getElementById('tl-add-a').onclick = () => store.mutate((p) => addTrack(p, 'audio'));
  document.getElementById('tl-delete').onclick = () => deleteSelected();
  document.getElementById('tl-ripple').onclick = () => deleteSelected({ ripple: true });
  document.getElementById('tl-split').onclick = () => splitSelected();
  document.getElementById('tl-duplicate').onclick = () => duplicateSelected();

  store.on('project', render);
  store.on('analysis', render);
  store.on('mediavis', render);
  document.getElementById('tl-cut-beats').onclick = () => cutOnBeats(Number(document.getElementById('tl-beat-n').value));
  store.on('selection', () => { for (const n of content.querySelectorAll('.clip')) n.classList.toggle('sel', store.multi.has(n.dataset.clip)); });
  store.on('playhead', () => { placePlayhead(); followPlayhead(); });
  render();
  addEventListener('resize', render);
  return { render, setZoom };
}

export function splitSelected() {
  const clip = store.selectedClip;
  const t = store.playhead;
  const targets = clip && t > clip.start && t < clipEnd(clip) ? [clip] : store.project.clips.filter((c) => t > c.start && t < clipEnd(c) && findTrack(store.project, c.trackId));
  if (!targets.length) return false;
  store.snapshot();
  let did = false, last = null;
  for (const c of targets) { const r = splitClip(store.project, c.id, t); if (r) { did = true; last = r; } }
  if (!did) { store.undoStack.pop(); return false; }
  store.touch('project');
  if (clip && last) store.select(last.id);
  return true;
}

/** Splits the selected clip at every n-th detected beat. Analyses the audio first if needed. */
export async function cutOnBeats(n = 4) {
  const clip = store.selectedClip;
  if (!clip) { toast('Select a clip to cut first.', 'error'); return 0; }
  if (!store.analysis || store.analysisStale) await runAnalysis({ quiet: true });
  const beats = store.analysis?.beats;
  if (!beats?.length) { toast('No beats found — import music and run the audio analysis.', 'error'); return 0; }
  const cuts = beats.filter((b, i) => i % n === 0 && b > clip.start + 0.15 && b < clipEnd(clip) - 0.15);
  if (!cuts.length) { toast('No beats fall inside this clip.', 'error'); return 0; }
  store.snapshot();
  let current = clip.id, made = 0;
  for (const t of cuts) {
    const right = splitClip(store.project, current, t);
    if (!right) continue;
    current = right.id; made++;
  }
  store.touch('project');
  toast(`Cut into ${made + 1} pieces on every ${n === 1 ? '' : n + 'th '}beat.`);
  return made;
}

const MONTAGE_TRANSITIONS = ['flash', 'punch', 'glitch', 'none', 'whip', 'punch'];
const MONTAGE_LOOKS = [null, 'Xerox Photocopy', 'Comic Flash (red/yellow)', null, 'Midnight Purple', 'Neon Solarize', 'Halftone Print (B&W)', 'Tour Tape (VHS)'];

/** Fills a fresh video track with the imported clips/images, cut on the beat grid of the music. */
export async function autoMontage({ every = 2, looks = true, seed = Date.now() % 1e6 } = {}) {
  const media = store.project.media.filter((m) => (m.kind === 'video' || m.kind === 'image') && !m.missing);
  if (!media.length) { toast('Import some video clips or images first.', 'error'); return 0; }
  if (!store.analysis || store.analysisStale) await runAnalysis({ quiet: true });
  const a = store.analysis;
  if (!a?.beats.length) { toast('No beats found — add a music track to the timeline first.', 'error'); return 0; }
  const plan = planMontage({ beats: a.beats, every, total: a.duration, media, seed });
  if (!plan.length) return 0;
  store.snapshot();
  const track = addTrack(store.project, 'video');
  plan.forEach((seg, i) => {
    const clip = addMediaClip(store.project, seg.mediaId, track.id, seg.start);
    if (!clip) return;
    clip.duration = seg.duration; clip.in = seg.in; clip.start = seg.start;
    const look = looks ? MONTAGE_LOOKS[Math.abs((seed >> 3) + i * 5 + (i >> 1)) % MONTAGE_LOOKS.length] : null;
    if (look) clip.effects = instantiatePreset(EFFECT_PRESETS.find((p) => p.name === look));
    if (looks && i > 0) clip.transition = { type: MONTAGE_TRANSITIONS[Math.abs((seed >> 5) + i * 3) % MONTAGE_TRANSITIONS.length], duration: 0.2 };
  });
  store.touch('project');
  toast(`Auto-montage: ${plan.length} cuts on ${every === 1 ? 'every beat' : `every ${every}th beat`}, on a new video track (drag it down or hide the old one).`);
  return plan.length;
}

const fresh = (clip) => {
  const c = structuredClone(clip);
  c.id = uid('clip');
  for (const fx of c.effects || []) fx.id = uid('fx');
  return c;
};

function placeCopy(copy, trackId, start) {
  const p = store.project;
  const track = findTrack(p, trackId) || p.tracks.find((t) => canPlace(p, copy, t));
  if (!track || !canPlace(p, copy, track)) return null;
  copy.trackId = track.id;
  copy.start = Math.max(0, start);
  if (overlaps(p, track.id, copy.start, copy.duration)) copy.start = trackEnd(p, track.id);
  p.clips.push(copy);
  return copy;
}

/** Duplicates the selected clip right after itself (effects, keyframes and bindings included). */
export function duplicateSelected() {
  const c = store.selectedClip;
  if (!c) return false;
  store.snapshot();
  const copy = placeCopy(fresh(c), c.trackId, clipEnd(c));
  if (!copy) { store.undoStack.pop(); return false; }
  store.touch('project'); store.select(copy.id);
  return true;
}

export function copySelected() {
  const c = store.selectedClip;
  if (!c) return false;
  store.clipboard = JSON.stringify(c);
  return true;
}

/** Pastes the copied clip at the playhead on its original track (or the first compatible one). */
export function pasteClip() {
  if (!store.clipboard) return false;
  const src = JSON.parse(store.clipboard);
  store.snapshot();
  const copy = placeCopy(fresh(src), store.selectedClip?.trackId || src.trackId, store.playhead);
  if (!copy) { store.undoStack.pop(); toast("Can't paste that clip here.", 'error'); return false; }
  store.touch('project'); store.select(copy.id);
  return true;
}

/** Deletes the whole selection; `ripple` closes the gaps it leaves on each track. */
export function deleteSelected({ ripple = false } = {}) {
  const ids = store.multi.size ? [...store.multi] : store.selection ? [store.selection] : [];
  if (!ids.length) return false;
  store.mutate((p) => deleteClips(p, ids, { ripple }));
  store.select(null);
  return true;
}
