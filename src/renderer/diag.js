// Usage notes (renderer side): OFF unless the artist turns it on. Counts how smoothly playback ran, what exports took, which features were used and which errors
// happened, in this computer's local storage only. Nothing leaves it except a report the artist saves to a file themselves. See shared/diag/notes.js for exactly what is kept.
import { store } from './store.js';
import { emptyNotes, cleanNotes, addFrame, addExport, addCount, addError, setMachine, buildReport } from '/shared/diag/notes.js';
import { metaFor } from '/shared/mutation/effect-meta.js';

const KEY = 'hhlab.diag.v1', ON = 'hhlab.diag.on';
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
const load = () => { try { return cleanNotes(JSON.parse(read(KEY) || 'null')); } catch { return emptyNotes(0); } };

/** Effects (and heavy ones) switched on in the clips that are on screen at time t: the "load" a frame was drawn under. */
function loadAt(project, t) {
  let effects = 0, heavy = 0;
  for (const c of project.clips || []) {
    if (!(t >= c.start && t < c.start + c.duration) || !Array.isArray(c.effects)) continue;
    for (const e of c.effects) if (e.enabled !== false) { effects++; if (metaFor(e.type)?.cost === 'heavy') heavy++; }
  }
  return { effects, heavy };
}

async function machine() {
  let info = {}; try { info = (await window.hh?.appInfo?.()) || {}; } catch { /* the editor carries on without it */ }
  let gpu = '';
  try { const gl = document.createElement('canvas').getContext('webgl2'); const x = gl?.getExtension('WEBGL_debug_renderer_info'); gpu = x ? String(gl.getParameter(x.UNMASKED_RENDERER_WEBGL)) : ''; } catch { /* no gpu name */ }
  const ua = navigator.userAgent || '';
  return { app: info.version || '', platform: navigator.userAgentData?.platform || navigator.platform || '', arch: info.arch || '', electron: /Electron\/([\d.]+)/.exec(ua)?.[1] || '', chrome: /Chrome\/([\d.]+)/.exec(ua)?.[1] || '',
    cpus: navigator.hardwareConcurrency || 0, memGB: navigator.deviceMemory || 0, dpr: window.devicePixelRatio || 1, gpu, software: /swiftshader|llvmpipe|software/i.test(gpu) };
}

export const diag = {
  enabled: read(ON) === '1',
  notes: load(),
  clock: () => Date.now(),
  listeners: new Set(),
  _last: 0, _timer: 0,
  _changed() { for (const f of this.listeners) { try { f(); } catch (e) { console.error(e); } } },
  _dirty() { if (!this._timer) this._timer = setTimeout(() => { this._timer = 0; this.save(); }, 15000); },
  save() { write(KEY, JSON.stringify(this.notes)); },
  async setEnabled(on) {
    this.enabled = !!on; write(ON, on ? '1' : '0'); this._last = 0;
    if (on) { if (!this.notes.since) this.notes = emptyNotes(this.clock()); this.notes = setMachine(this.notes, await machine()); this.notes = addCount(this.notes, 'app.session'); }
    this.save(); this._changed();
  },
  count(key) { if (!this.enabled) return; this.notes = addCount(this.notes, key); this._dirty(); },
  error(msg) { if (!this.enabled) return; this.notes = addError(this.notes, msg); this._dirty(); },
  /** Called after each drawn preview frame with the time the drawing call took. Only frames drawn while playing count. */
  frame(renderMs, project, t) {
    if (!this.enabled || !store.playing) { this._last = 0; return; }
    const now = performance.now(), interval = this._last ? now - this._last : 0; this._last = now;
    if (!interval) return;
    const { effects, heavy } = loadAt(project, t), s = project.settings;
    this.notes = addFrame(this.notes, { interval, render: renderMs, w: s.width, h: s.height, effects, heavy }); this._dirty();
  },
  exportDone(info) { if (!this.enabled) return; this.notes = addExport(this.notes, info); this.save(); this._changed(); },
  report() { return buildReport(this.notes, this.clock()); },
  clear() { this.notes = this.enabled ? { ...emptyNotes(this.clock()), machine: this.notes.machine } : emptyNotes(0); this.save(); this._changed(); },
  summary() {
    const frames = Object.values(this.notes.perf).reduce((a, b) => a + b.n, 0), uses = Object.entries(this.notes.counts).filter(([k]) => k !== 'app.session').reduce((a, [, c]) => a + c, 0);
    return { frames, exports: this.notes.exports.length, uses, errors: Object.keys(this.notes.errors).length, since: this.notes.since };
  },
};
// errors that reach the console or the window, with paths and addresses removed before they are kept
addEventListener('error', (e) => diag.error(e.message));
addEventListener('unhandledrejection', (e) => diag.error(e.reason?.message ?? e.reason));
const origError = console.error.bind(console);
console.error = (...a) => { try { if (diag.enabled) diag.error(a.map((x) => x?.message ?? String(x)).join(' ')); } catch { /* never let notes break logging */ } origError(...a); };
addEventListener('beforeunload', () => { if (diag.enabled) diag.save(); });
