// DOM timeline: ruler, track rows, draggable/trimmable clips, playhead, drag-and-drop from the media bin.
import { el } from './dom.js';
import { store } from '../store.js';
import { clipEnd, projectDuration, moveClip, trimStart, trimEnd, splitClip, deleteClip, addMediaClip, addTrack, clipKind } from '/shared/timeline.js';
import { findMedia, findTrack } from '/shared/project.js';

const LABEL_W = 118;
const SNAP_PX = 8;

export function mountTimeline() {
  const scroll = document.getElementById('tl-scroll');
  const content = document.getElementById('tl-content');
  const zoomIn = document.getElementById('tl-zoom');
  const snapBox = document.getElementById('tl-snap');
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
    const n = el('div', { class: `clip ${kind} ${store.selection === clip.id ? 'sel' : ''}`, 'data-clip': clip.id, style: `left:${px(clip.start)}px;width:${Math.max(4, px(clip.duration))}px`, title: clip.name },
      el('span', { class: 'nm', text: clip.name || (media?.name ?? clip.type) }),
      fxCount ? el('span', { class: 'badge', text: `fx${fxCount}` }) : null,
      media?.missing ? el('span', { class: 'badge', text: '⚠ missing' }) : null,
      kfs.length ? el('div', { class: 'kfs' }, kfs) : null,
      el('div', { class: 'h l', 'data-h': 'l' }), el('div', { class: 'h r', 'data-h': 'r' }));
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
    store.select(clip.id);
    const mode = e.target.dataset.h || 'move';
    const startX = e.clientX;
    const orig = { start: clip.start, duration: clip.duration, in: clip.in, trackId: clip.trackId };
    let snapped = false;
    const ensure = () => { if (!snapped) { store.snapshot(); snapped = true; } };
    const move = (ev) => {
      const dt = (ev.clientX - startX) / store.zoom;
      if (Math.abs(ev.clientX - startX) < 3 && !snapped) return;
      ensure();
      if (mode === 'move') {
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
  document.getElementById('tl-split').onclick = () => splitSelected();

  store.on('project', render);
  store.on('selection', () => { for (const n of content.querySelectorAll('.clip')) n.classList.toggle('sel', n.dataset.clip === store.selection); });
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

export function deleteSelected() {
  const id = store.selection;
  if (!id) return false;
  store.mutate((p) => deleteClip(p, id));
  store.select(null);
  return true;
}
