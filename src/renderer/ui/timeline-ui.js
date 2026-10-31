// DOM timeline: ruler, track rows, draggable/trimmable clips, playhead, drag-and-drop from the media bin.
import { el, toast } from './dom.js';
import { runAnalysis } from './reactive-ui.js';
import { visualsFor, drawVisuals } from '../engine/media-cache.js';
import { planMontage } from '/shared/montage.js';
import { EFFECT_PRESETS, instantiatePreset } from '/shared/effects-defs.js';
import { store } from '../store.js';
import { dissolveInto, moveClips, deleteClips, overlaps, trackEnd, canPlace, clipEnd, projectDuration, moveClip, trimStart, trimEnd, splitClip, deleteClip, addMediaClip, addTrack, clipKind, moveTrack, removeEmptyTrack } from '/shared/timeline.js';
import { findMedia, findTrack, uid } from '/shared/project.js';
import { reverseSelected, freezeAtPlayhead } from '../engine/edit-tools.js';
import { stutterAtPlayhead } from '../engine/rhythm-tools.js';
import { activeRange, markRange } from '/shared/timeline.js';

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
    // render range: shaded stretch with an In and an Out flag you can drag
    const rng = activeRange(project);
    if (rng) {
      rl.append(el('div', { class: 'range-fill', style: `left:${px(rng.in)}px;width:${px(rng.out - rng.in)}px` }));
      for (const which of ['in', 'out']) {
        const f = el('div', { class: `range-flag ${which}`, style: `left:${px(rng[which])}px`, title: which === 'in' ? 'Render starts here — drag to move (I sets it at the playhead)' : 'Render ends here — drag to move (O sets it at the playhead)', text: which === 'in' ? 'IN' : 'OUT' });
        f.addEventListener('pointerdown', (e) => beginRangeDrag(e, which, f, rl));
        rl.append(f);
      }
    }
    ruler.append(rl);
    content.append(ruler);
    rl.addEventListener('pointerdown', (e) => scrub(e, rl));

    // tracks
    for (const track of project.tracks) {
      const lane = el('div', { class: `tl-lane ${track.kind}`, 'data-track': track.id, style: `width:${lw}px` });
      lane.addEventListener('pointerdown', (e) => { if (e.target === lane) beginMarquee(e, lane); });
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

      const idx = project.tracks.indexOf(track), last = project.tracks.length - 1;
      const name = el('b', { text: track.name, title: 'Double-click to rename' });
      name.addEventListener('dblclick', () => renameTrack(name, track));
      const grip = el('span', { class: 'grip', title: 'Drag to move this track up or down (video tracks draw over the ones below them)', 'aria-label': `Move track ${track.name}`, text: '⠿' });
      grip.addEventListener('pointerdown', (e) => beginTrackDrag(e, track));
      const label = el('div', { class: 'tl-label' }, el('div', { class: 'tl-name' }, grip, name),
        el('div', {},
          el('button', { class: track.muted ? 'on' : '', text: 'M', title: 'Mute audio on this track', onclick: () => store.mutate(() => { track.muted = !track.muted; }) }),
          track.kind === 'video' ? el('button', { class: track.hidden ? 'on' : '', text: 'H', title: 'Hide this track in the preview and export', onclick: () => store.mutate(() => { track.hidden = !track.hidden; }) }) : null,
          el('button', { class: 'mv up', text: '▲', title: 'Move track up', disabled: idx === 0, onclick: () => store.mutate((p) => moveTrack(p, track.id, idx - 1)) }),
          project.clips.some((c) => c.trackId === track.id) || project.tracks.filter((x) => x.kind === track.kind).length <= 1 ? null
            : el('button', { class: 'mv rm', text: '×', title: 'Remove this empty track', onclick: () => store.mutate((p) => removeEmptyTrack(p, track.id)) }),
          el('button', { class: 'mv down', text: '▼', title: 'Move track down', disabled: idx === last, onclick: () => store.mutate((p) => moveTrack(p, track.id, idx + 1)) })));
      content.append(el('div', { class: 'tl-row', 'data-row': track.id }, label, lane));
    }
    playheadEl = el('div', { class: 'playhead' });
    content.append(playheadEl);
    placePlayhead();
  }

  function renameTrack(nameEl, track) {
    const input = el('input', { type: 'text', value: track.name, class: 'tl-rename', maxlength: 14, 'aria-label': 'Track name' });
    nameEl.replaceWith(input); input.focus(); input.select();
    let finished = false; // Enter re-renders the timeline, which removes the input and fires blur: only finish once
    const done = (keep) => { if (finished) return; finished = true; const v = input.value.trim(); if (keep && v && v !== track.name) store.mutate(() => { track.name = v; }); else render(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true));
  }

  // drag a track's grip to a new row: a line shows where it will land, release to drop
  function beginTrackDrag(e, track) {
    e.preventDefault();
    const rows = [...content.querySelectorAll('.tl-row')];
    const marker = el('div', { class: 'tl-drop' });
    content.append(marker);
    const from = store.project.tracks.indexOf(track);
    let to = from;
    const place = (ev) => {
      const rects = rows.map((r) => r.getBoundingClientRect());
      let i = rects.findIndex((r) => ev.clientY < r.top + r.height / 2);
      if (i < 0) i = rects.length;            // below the last row
      to = i > from ? i - 1 : i;             // index after removing the dragged row
      const y = i >= rects.length ? rects.at(-1).bottom : rects[i].top;
      marker.style.top = `${y - content.getBoundingClientRect().top}px`;
      rows[from]?.classList.add('dragging');
    };
    place(e);
    const move = (ev) => place(ev);
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      marker.remove();
      if (to !== from) store.mutate((p) => moveTrack(p, track.id, to)); else render();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
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

  function snapTargets(exclude) {
    const ts = [0, store.playhead];
    const r = store.project.range;
    if (r) ts.push(r.in, r.out);
    if (beatSnap.checked && store.analysis) ts.push(...store.analysis.beats);
    for (const c of store.project.clips) if (!exclude.has(c.id)) ts.push(c.start, clipEnd(c));
    return ts;
  }
  /** Nearest snap point for time t (also tries t + each offset, e.g. the clip's end). Returns {t, at} where `at` is the snap line, or null. */
  function snapInfo(t, exclude, also = []) {
    if (!snapBox.checked) return { t, at: null };
    let best = t, bd = SNAP_PX / store.zoom, at = null;
    for (const s of snapTargets(exclude)) for (const off of [0, ...also]) {
      const d = Math.abs(t + off - s);
      if (d < bd) { bd = d; best = s - off; at = s; }
    }
    return { t: best, at };
  }
  const snap = (t, excludeId, also = []) => snapInfo(t, new Set([excludeId]), also).t;

  // ---- drag helpers: everything below touches only the DOM until the pointer is released ----
  let snapLine = null;
  const showSnap = (at) => {
    if (at == null) { snapLine?.remove(); snapLine = null; return; }
    if (!snapLine || !snapLine.isConnected) { snapLine = el('div', { class: 'snap-line' }); content.append(snapLine); }
    snapLine.style.left = `${LABEL_W + px(at)}px`;
  };
  /** Scrolls the timeline when a drag nears its edge, so long moves don't need the wheel. */
  function edgeScroll(ev) {
    const r = scroll.getBoundingClientRect(), m = 36;
    if (ev.clientX > r.right - m) scroll.scrollLeft += Math.min(24, (ev.clientX - (r.right - m)) / 2);
    else if (ev.clientX < r.left + LABEL_W + m && scroll.scrollLeft > 0) scroll.scrollLeft -= Math.min(24, (r.left + LABEL_W + m - ev.clientX) / 2);
    if (ev.clientY > r.bottom - m) scroll.scrollTop += 10; else if (ev.clientY < r.top + m + 20) scroll.scrollTop -= 10;
  }
  const rowAt = (clientY) => {
    const rows = [...content.querySelectorAll('.tl-row')];
    if (!rows.length) return null;
    const hit = rows.find((r) => { const b = r.getBoundingClientRect(); return clientY >= b.top && clientY < b.bottom; });
    return hit || (clientY < rows[0].getBoundingClientRect().top ? rows[0] : rows.at(-1));
  };
  const nodeOf = (id) => content.querySelector(`.clip[data-clip="${id}"]`);

  function beginDrag(e, clip, node) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (e.shiftKey || e.metaKey || e.ctrlKey) { store.toggleSelect(clip.id); return; } // build a multi-selection, no drag
    const handle = e.target.dataset.h;
    const inGroup = store.multi.has(clip.id) && store.multi.size > 1 && !handle;
    if (!inGroup) store.select(clip.id); else { store.selection = clip.id; store.emit('selection'); }
    const startX = e.clientX;
    if (handle) return beginTrim(e, clip, handle);

    // The moving set: the whole selection (or just this clip). Positions are computed against the untouched project and only
    // written back on release, as one undo step — nothing is rebuilt while the pointer moves, so long drags stay smooth.
    const ids = inGroup ? [...store.multi] : [clip.id];
    const moving = ids.map((id) => store.project.clips.find((c) => c.id === id)).filter(Boolean);
    const exclude = new Set(ids);
    const trackIdx = (id) => store.project.tracks.findIndex((t) => t.id === id);
    const base = moving.map((c) => ({ c, start: c.start, ti: trackIdx(c.trackId) }));
    const minStart = Math.min(...base.map((b) => b.start));
    const primaryTi = trackIdx(clip.trackId);
    let result = null; // last valid {dt, dTrack}
    let moved = false;

    const valid = (dt, dTrack) => base.every(({ c, start, ti }) => {
      const track = store.project.tracks[ti + dTrack];
      if (!track || !canPlace(store.project, c, track)) return false;
      const ns = start + dt;
      return !store.project.clips.some((o) => !exclude.has(o.id) && o.trackId === track.id && ns < clipEnd(o) - 1e-6 && ns + c.duration > o.start + 1e-6);
    });
    const apply = (dt, dTrack) => {
      for (const { c, start, ti } of base) {
        const n = nodeOf(c.id); if (!n) continue;
        n.style.left = `${px(start + dt)}px`;
        n.classList.add('dragging');
        const lane = content.querySelector(`.tl-lane[data-track="${store.project.tracks[ti + dTrack].id}"]`);
        if (lane && n.parentElement !== lane) lane.append(n);
      }
    };
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3 && Math.abs(ev.clientY - e.clientY) < 3) return;
      moved = true;
      edgeScroll(ev);
      let dt = (ev.clientX - startX) / store.zoom;
      dt = Math.max(dt, -minStart);                                         // nothing may start before 0
      const s = snapInfo(clip.start + dt, exclude, [clip.duration]);        // snap the dragged clip's start or end to other clips, the playhead, beats, range marks
      dt = Math.max(s.t - clip.start, -minStart);
      const row = rowAt(ev.clientY);
      const dTrack = row ? trackIdx(row.dataset.row) - primaryTi : 0;
      let ok = valid(dt, dTrack) ? { dt, dTrack } : valid(dt, 0) ? { dt, dTrack: 0 } : valid(0, dTrack) ? { dt: 0, dTrack } : null; // fall back gracefully instead of freezing
      if (!ok) return;
      result = ok;
      showSnap(s.at != null && ok.dt === dt ? s.at : null);
      apply(ok.dt, ok.dTrack);
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      showSnap(null);
      if (!moved || !result || (result.dt === 0 && result.dTrack === 0)) { render(); return; }
      store.snapshot();
      for (const { c, start, ti } of base) { c.start = Math.max(0, start + result.dt); c.trackId = store.project.tracks[ti + result.dTrack].id; }
      store.touch('project');
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  /** Trim: edits the project directly but only moves this one node while dragging; a full rebuild happens on release. */
  function beginTrim(e, clip, which) {
    const startX = e.clientX, orig = { start: clip.start, duration: clip.duration };
    const exclude = new Set([clip.id]);
    const node = nodeOf(clip.id);
    let snapped = false;
    const move = (ev) => {
      if (!snapped && Math.abs(ev.clientX - startX) < 3) return;
      if (!snapped) { store.snapshot(); snapped = true; }
      edgeScroll(ev);
      const dt = (ev.clientX - startX) / store.zoom;
      const s = snapInfo(which === 'l' ? orig.start + dt : orig.start + orig.duration + dt, exclude);
      if (which === 'l') trimStart(store.project, clip.id, s.t); else trimEnd(store.project, clip.id, s.t);
      showSnap(s.at);
      if (node) { node.style.left = `${px(clip.start)}px`; node.style.width = `${Math.max(4, px(clip.duration))}px`; }
      store.touch('render');
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); showSnap(null); if (snapped) store.touch('project'); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  /** Drag on an empty stretch of a lane: a rubber band selects every clip it touches (Shift adds to the selection). A plain click moves the playhead. */
  function beginMarquee(e, lane) {
    if (e.button !== 0) return;
    const add = e.shiftKey || e.metaKey || e.ctrlKey;
    const rect0 = content.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const keep = add ? new Set(store.multi) : new Set();
    let band = null, active = false;
    const sel = (ev) => {
      const x0 = Math.min(sx, ev.clientX), x1 = Math.max(sx, ev.clientX), y0 = Math.min(sy, ev.clientY), y1 = Math.max(sy, ev.clientY);
      const r = content.getBoundingClientRect();
      Object.assign(band.style, { left: `${x0 - r.left}px`, top: `${y0 - r.top}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
      const hit = new Set(keep);
      for (const n of content.querySelectorAll('.clip')) { const b = n.getBoundingClientRect(); if (b.right >= x0 && b.left <= x1 && b.bottom >= y0 && b.top <= y1) hit.add(n.dataset.clip); }
      store.multi = hit; store.selection = [...hit].pop() ?? null;
      store.emit('selection', 'render');
    };
    const move = (ev) => {
      if (!active) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return; active = true; band = el('div', { class: 'marquee' }); content.append(band); }
      edgeScroll(ev);
      sel(ev);
    };
    const up = (ev) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      band?.remove();
      if (!active) { if (!add) store.select(null); store.setPlayhead(Math.max(0, (sx - lane.getBoundingClientRect().left) / store.zoom)); }
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  /** Drag an In/Out flag along the ruler (snaps like clips do); the range is written once on release. */
  function beginRangeDrag(e, which, flag, lane) {
    e.stopPropagation(); e.preventDefault();
    const startX = e.clientX, orig = store.project.range[which];
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) < 2) return;
      if (!moved) { store.snapshot(); moved = true; }
      edgeScroll(ev);
      const t = snapInfo(Math.max(0, orig + (ev.clientX - startX) / store.zoom), new Set()).t;
      markRange(store.project, which, t);
      const r = store.project.range;
      flag.style.left = `${px(r[which])}px`;
      const fill = lane.querySelector('.range-fill');
      if (fill) { fill.style.left = `${px(r.in)}px`; fill.style.width = `${px(r.out - r.in)}px`; }
      const other = lane.querySelector(`.range-flag.${which === 'in' ? 'out' : 'in'}`); if (other) other.style.left = `${px(r[which === 'in' ? 'out' : 'in'])}px`;
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (moved) store.touch('project'); };
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
  document.getElementById('tl-dissolve').onclick = () => dissolveSelected(Number(document.getElementById('tl-dissolve-d').value));
  document.getElementById('tl-ripple').onclick = () => deleteSelected({ ripple: true });
  document.getElementById('tl-reverse').onclick = () => reverseSelected();
  document.getElementById('tl-freeze').onclick = () => freezeAtPlayhead(Number(document.getElementById('tl-freeze-d').value));
  document.getElementById('tl-stutter').onclick = () => stutterAtPlayhead(Number(document.getElementById('tl-stutter-s').value), Number(document.getElementById('tl-stutter-n').value));
  document.getElementById('tl-mark-in').onclick = () => setMark('in');
  document.getElementById('tl-mark-out').onclick = () => setMark('out');
  document.getElementById('tl-mark-clear').onclick = () => clearRange();
  document.getElementById('tl-split').onclick = () => splitSelected();
  document.getElementById('tl-duplicate').onclick = () => duplicateSelected();

  store.on('project', () => { render(); rangeLabel(); });
  store.on('analysis', render);
  rangeLabel();
  store.on('mediavis', render);
  document.getElementById('tl-cut-beats').onclick = () => cutOnBeats(Number(document.getElementById('tl-beat-n').value));
  store.on('selection', () => { for (const n of content.querySelectorAll('.clip')) n.classList.toggle('sel', store.multi.has(n.dataset.clip)); });
  store.on('playhead', () => { placePlayhead(); followPlayhead(); });
  render();
  addEventListener('resize', render);
  return { render, setZoom };
}

function rangeLabel() {
  const lab = document.getElementById('tl-range'); if (!lab) return;
  const r = activeRange(store.project);
  lab.textContent = r ? `Render range ${fmtT(r.in)} → ${fmtT(r.out)} (${(r.out - r.in).toFixed(1)} s)` : 'No render range — whole project';
  lab.classList.toggle('on', !!r);
  document.getElementById('tl-mark-clear').disabled = !r;
}
const fmtT = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
/** I / O: mark where rendering starts / ends at the playhead. One undo step. */
export function setMark(which) {
  store.mutate((p) => { markRange(p, which, store.playhead); });
  toast(`${which === 'in' ? 'In' : 'Out'} point set at ${fmtT(store.playhead)}.`);
}
export function clearRange() {
  if (!store.project.range) return;
  store.mutate((p) => { delete p.range; });
}

/** Cross-dissolve into each selected clip from the picture clip before it. One undo step. */
export function dissolveSelected(seconds = 0.5) {
  const ids = store.multi.size ? [...store.multi] : store.selection ? [store.selection] : [];
  if (!ids.length) { toast('Select the clip you want to dissolve into.', 'error'); return 0; }
  const order = ids.map((id) => store.project.clips.find((c) => c.id === id)).filter(Boolean).sort((a, b) => a.start - b.start);
  store.snapshot();
  let n = 0;
  for (const c of order) if (dissolveInto(store.project, c.id, seconds)) n++;
  if (!n) { store.undoStack.pop(); toast('Nothing to dissolve: pick a picture clip that starts where another one ends (and has a little spare footage to overlap).', 'error'); return 0; }
  store.touch('project');
  toast(`Dissolved into ${n} clip${n === 1 ? '' : 's'} (${seconds} s). The incoming clip now sits on its own track above.`);
  return n;
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
