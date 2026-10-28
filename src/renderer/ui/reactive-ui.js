// Audio-Reactive tab: runs analysis of the project's audio mix and shows live meters.
import { el, toast } from './dom.js';
import { store } from '../store.js';
import { analyze, sampleFeatures } from '/shared/audio-analysis.js';
import { audioSources } from '/shared/export-plan.js';

let running = null, runningSig = null;

export async function runAnalysis({ quiet = false } = {}) {
  // an analysis already in flight is reused only if the audio has not changed since it started; otherwise its result is stale (e.g. started before a song was added)
  while (running && runningSig !== store.audioSignature()) await running.catch(() => {});
  if (running) return running;
  runningSig = store.audioSignature();
  running = (async () => {
    await null; // let `running` be assigned first: the no-audio path below returns at once and its `finally` must clear the finished job, not a stale one
    try {
      if (!audioSources(store.project).length) { store.analysis = null; store.analysisStale = false; store.analysisSig = store.audioSignature(); if (!quiet) toast('No audio in the project to analyze.'); return null; }
      const sig = store.audioSignature();
      const res = await window.hh.analyzeAudio(store.project);
      if (!res) { store.analysis = null; return null; }
      const pcm = new Float32Array(res.pcm);
      store.analysis = analyze(pcm, res.sampleRate, 60);
      store.analysisStale = false;
      store.analysisSig = sig;
      if (!quiet) toast(`Audio analyzed: ${store.analysis.beats.length} beats${store.analysis.bpm ? ` · ~${store.analysis.bpm} BPM` : ''}.`);
      return store.analysis;
    } catch (e) {
      toast(`Audio analysis failed: ${e.message}`, 'error');
      return null;
    } finally {
      running = null;
      store.emit('analysis', 'render');
    }
  })();
  return running;
}

export function mountReactive(root) {
  const meters = {};
  const mk = (k) => { const b = el('b'); const v = el('span', { text: '0.00' }); meters[k] = { b, v }; return el('div', { class: 'meter' }, el('span', { text: k }), el('i', {}, b), v); };
  const env = el('canvas', { id: 'env-canvas', width: 600, height: 140 });
  const status = el('div', { class: 'stat' });
  const enable = el('input', { type: 'checkbox', checked: store.project.reactive?.enabled !== false });
  enable.addEventListener('change', () => { store.project.reactive.enabled = enable.checked; store.touch('render'); });
  const btn = el('button', { class: 'primary', text: 'Analyze project audio', onclick: () => runAnalysis() });

  root.append(
    el('section', { class: 'card' }, el('h4', { text: 'Analysis' }),
      el('div', { class: 'body' },
        el('p', { class: 'hint', text: 'Analyzes the mixed audio of all unmuted clips (amplitude, 3 frequency bands, beats). Then press ∿ next to any parameter in the Inspector to bind it to a signal.' }),
        btn, status, el('label', { class: 'chk' }, enable, 'Audio-reactive bindings enabled'))),
    el('section', { class: 'card' }, el('h4', { text: 'Live signals' }), el('div', { class: 'body' }, ['rms', 'bass', 'mid', 'high', 'beat'].map(mk), env)));

  function drawEnv() {
    const a = store.analysis;
    const c = env.getContext('2d');
    const cs = getComputedStyle(document.documentElement);
    c.clearRect(0, 0, env.width, env.height);
    if (!a) return;
    const W = env.width, H = env.height, dur = a.duration;
    c.strokeStyle = cs.getPropertyValue('--accent2'); c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x < W; x++) {
      const i = Math.floor((x / W) * a.rms.length);
      const y = H - a.rms[i] * (H - 6) - 2;
      x ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
    c.fillStyle = cs.getPropertyValue('--dim');
    for (const b of a.beats) c.fillRect(Math.floor((b / dur) * W), 0, 1, 10);
    c.fillStyle = cs.getPropertyValue('--text');
    c.fillRect(Math.floor((store.playhead / dur) * W), 0, 2, H);
  }

  function update() {
    const a = store.analysis;
    status.replaceChildren();
    if (!a) status.append(el('span', { class: 'warn', text: store.analysisStale ? 'Not analyzed yet.' : 'No audio.' }));
    else status.append(`duration `, el('b', { text: `${a.duration.toFixed(1)}s` }), `  beats `, el('b', { text: a.beats.length }), `  tempo `, el('b', { text: a.bpm ? `~${a.bpm}` : '—' }),
      store.analysisStale ? el('span', { class: 'warn', text: '  (stale — project audio changed)' }) : '');
    drawEnv();
  }
  let raf = 0;
  const live = () => {
    raf = 0;
    const f = sampleFeatures(store.analysis, store.playhead) || { rms: 0, bass: 0, mid: 0, high: 0, beat: 0 };
    for (const [k, m] of Object.entries(meters)) { m.b.style.width = `${Math.round(f[k] * 100)}%`; m.v.textContent = f[k].toFixed(2); }
    drawEnv();
  };
  store.on('playhead', () => { if (!raf && root.classList.contains('on')) raf = requestAnimationFrame(live); });
  store.on('analysis', update);
  store.on('project', update);
  store.on('reset', () => { enable.checked = store.project.reactive?.enabled !== false; update(); });
  store.on('need-analysis', () => { if (!store.analysis || store.analysisStale) runAnalysis({ quiet: true }); });
  update();
}
