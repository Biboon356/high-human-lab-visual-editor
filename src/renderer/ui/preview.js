// Live preview: owns the preview compositor, the media pool, the transport and the render loop.
import { store } from '../store.js';
import { Compositor } from '../engine/compositor.js';
import { Sources } from '../engine/sources.js';
import { sampleFeatures } from '/shared/audio-analysis.js';
import { projectDuration } from '/shared/timeline.js';
import { fmtTime } from './dom.js';

const MAX_PREVIEW_W = 1280;

export function mountPreview() {
  const canvas = document.getElementById('preview');
  const msg = document.getElementById('preview-msg');
  const playBtn = document.getElementById('t-play');
  const seek = document.getElementById('seek');
  const tc = document.getElementById('timecode');
  const dur = document.getElementById('duration');
  const loop = document.getElementById('loop');
  const sources = new Sources({ mediaUrl: (p) => window.hh.mediaUrl(p), audible: true });
  let comp;
  try {
    comp = new Compositor(canvas, 960, 540);
  } catch (e) {
    msg.hidden = false; msg.textContent = e.message;
    throw e;
  }
  let dirty = true, wallStart = 0, tStart = 0;
  const stats = { frames: 0, lastError: null };

  const fitSize = () => {
    const { width, height } = store.project.settings;
    const w = Math.min(width, MAX_PREVIEW_W);
    const h = Math.round((w * height) / width);
    if (comp.w !== w || comp.h !== h) comp.resize(w, h);
  };

  const features = () => (store.project.reactive?.enabled ? sampleFeatures(store.analysis, store.playhead) : null);

  function draw() {
    sources.sync(store.project, store.playhead, store.playing);
    try {
      const r = comp.render({ project: store.project, t: store.playhead, sources, features: features() });
      stats.frames++;
      const errs = [...sources.errors.values()];
      if (errs.length) show(errs[0]); else if (r.missing.length && !store.playing) show(`Loading ${r.missing[0]}…`); else show('');
    } catch (e) {
      show(`Render error: ${e.message}`);
      stats.lastError = e;
      console.error(e);
    }
  }
  const show = (m) => { msg.hidden = !m; msg.textContent = m; };

  const duration = () => projectDuration(store.project);
  const fps = () => store.project.settings.fps;

  function updateUI() {
    const d = duration();
    tc.textContent = fmtTime(store.playhead);
    dur.textContent = fmtTime(d);
    if (document.activeElement !== seek) seek.value = d > 0 ? Math.round((store.playhead / d) * 1000) : 0;
    playBtn.textContent = store.playing ? '❚❚' : '▶';
  }

  function play() {
    const d = duration();
    if (d <= 0) return;
    if (store.playhead >= d - 0.01) store.setPlayhead(0);
    store.playing = true;
    wallStart = performance.now(); tStart = store.playhead;
    updateUI();
  }
  function pause() {
    if (!store.playing) return;
    store.playing = false;
    sources.pauseAll();
    updateUI(); dirty = true;
  }
  const toggle = () => (store.playing ? pause() : play());

  function frame() {
    requestAnimationFrame(frame);
    if (store.playing) {
      let t = tStart + (performance.now() - wallStart) / 1000;
      const d = duration();
      if (t >= d) {
        if (loop.checked && d > 0) { t = 0; tStart = 0; wallStart = performance.now(); }
        else { t = d; store.setPlayhead(t); pause(); draw(); return; }
      }
      store.playhead = t;
      store.emit('playhead');
      updateUI();
      draw();
    } else if (dirty) {
      dirty = false;
      draw();
    }
  }

  store.on('render', () => { dirty = true; });
  store.on('playhead', () => { updateUI(); dirty = true; });
  store.on('project', () => { fitSize(); updateUI(); dirty = true; });
  store.on('reset', () => { fitSize(); dirty = true; });
  sources.onFrameReady = () => { dirty = true; };
  store.on('relink', () => { sources.forgetMedia(store.project, store.relinkedMedia); dirty = true; });

  seek.addEventListener('input', () => { store.setPlayhead((Number(seek.value) / 1000) * duration()); });
  playBtn.onclick = toggle;
  document.getElementById('t-start').onclick = () => store.setPlayhead(0);
  document.getElementById('t-end').onclick = () => store.setPlayhead(duration());
  document.getElementById('t-back').onclick = () => { pause(); store.setPlayhead(store.playhead - 1 / fps()); };
  document.getElementById('t-fwd').onclick = () => { pause(); store.setPlayhead(store.playhead + 1 / fps()); };

  // Safe-zone guide: hatched bands where TikTok's own interface covers the picture (bottom ~20%, right ~14%, top ~8%)
  const safe = document.createElement('div');
  safe.className = 'safe-zone'; safe.hidden = true;
  safe.innerHTML = '<i style="left:0;right:0;bottom:0;height:20%">CAPTION / UI ZONE</i><i style="top:0;right:0;width:14%;height:80%;top:20%"></i><i style="left:0;right:0;top:0;height:8%"></i>';
  document.getElementById('preview-wrap').append(safe);
  const placeSafe = () => {
    const wrap = document.getElementById('preview-wrap'), { width, height } = store.project.settings;
    const cw = wrap.clientWidth - 32, ch = wrap.clientHeight - 32, k = Math.min(cw / width, ch / height);
    const w = width * k, h = height * k;
    Object.assign(safe.style, { width: `${w}px`, height: `${h}px`, left: `${16 + (cw - w) / 2}px`, top: `${16 + (ch - h) / 2}px` });
  };
  let safeOn = false;
  try { safeOn = localStorage.getItem('hhlab.safezone') === '1'; } catch { /* storage unavailable */ }
  const showSafe = () => { safe.hidden = !safeOn; document.getElementById('t-safe').classList.toggle('on', safeOn); if (safeOn) placeSafe(); };
  document.getElementById('t-safe').onclick = () => { safeOn = !safeOn; try { localStorage.setItem('hhlab.safezone', safeOn ? '1' : '0'); } catch { /* ignore */ } showSafe(); };
  addEventListener('resize', () => safeOn && placeSafe());
  store.on('project', () => safeOn && placeSafe());
  showSafe();

  fitSize(); updateUI();
  requestAnimationFrame(frame);
  return { play, pause, toggle, sources, comp, stats, forceDraw: draw };
}
