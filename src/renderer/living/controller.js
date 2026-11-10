// LivingLabController: the one place that knows whether a recording session (a take or a trace) is running. Both sessions work the
// same way: remember an undo point, play the timeline from the playhead, collect what the hand does, and when playback stops hand the
// result to the module that knows how to turn it into ordinary keyframes or a clip. It keeps no state of its own about the project.
import { store } from '../store.js';
import { toast } from '../ui/dom.js';
import { projectDuration, activeRange } from '/shared/timeline.js';
import { findClip } from '/shared/project.js';
import { LabTake } from './lab-take.js';
import { HumanTrace } from './human-trace.js';
import { LabAccident } from './lab-accident.js';

export class LivingLabController {
  constructor({ preview }) {
    this.preview = preview;
    this.session = null;
    this.settings = { smooth: 0.25, loop: (() => { try { return localStorage.getItem('hhlab.living.loop') !== 'off'; } catch { return true; } })() }; // smooth 0..1 and loop, shared by take and trace
    this.last = null; // {text} shown by the UI after a session
    this.take = new LabTake(this);
    this.trace = new HumanTrace(this);
    this.accident = new LabAccident();
  }

  get busy() { return !!this.session; }

  /** Keyframe tolerance and smoothing from the one "Smoothing" control: more smoothing = fewer, calmer keys. */
  curve() { return { tol: 0.01 + this.settings.smooth * 0.04, smooth: this.settings.smooth }; }

  /** Timeline seconds right now, measured on the same wall clock the preview plays by (finer than the frame-by-frame playhead). */
  clock() { return this.session ? this.session.t0 + (performance.now() - this.session.wall0) / 1000 : store.playhead; }

  setLoop(on) { this.settings.loop = !!on; try { localStorage.setItem('hhlab.living.loop', on ? 'on' : 'off'); } catch { /* storage unavailable */ } }

  /** The stretch a looping session plays over: the marked In/Out range, else the selected clips, else the whole project. */
  loopSpan() {
    const dur = projectDuration(store.project), r = activeRange(store.project);
    if (r) return { a: r.in, b: r.out, label: 'the marked range' };
    const sel = [...store.multi].map((id) => findClip(store.project, id)).filter(Boolean);
    if (sel.length) { const a = Math.min(...sel.map((c) => c.start)), b = Math.max(...sel.map((c) => c.start + c.duration)); if (b - a >= 0.5) return { a, b: Math.min(b, dur), label: sel.length === 1 ? 'the selected clip' : 'the selected clips' }; }
    return { a: 0, b: dur, label: 'the whole project' };
  }

  begin(kind, handlers) {
    if (this.session) return false;
    const dur = projectDuration(store.project);
    if (dur <= 0) { toast('Put something on the timeline first.', 'error'); return false; }
    const span = this.settings.loop ? this.loopSpan() : null;
    const loop = span && span.b - span.a >= 0.3 ? span : null;
    store.clearGhost(); // a session works on the real project
    store.snapshot(); // one undo step for the whole session
    const t0 = loop ? loop.a : store.playhead >= dur - 0.05 ? 0 : store.playhead; // a loop always starts at its beginning
    store.setPlayhead(t0);
    this.session = { kind, t0, wall0: performance.now(), handlers, loop, pass: 0 };
    store.loopRange = loop ? [loop.a, loop.b] : null;
    // each time the preview wraps round, a new pass begins: the clock starts again at the start of the stretch
    this._offLoop = loop ? store.on('loop', () => {
      const s = this.session;
      if (!s) return;
      s.pass++; s.t0 = s.loop.a; s.wall0 = performance.now();
      try { s.handlers.pass?.({ tEnd: s.loop.b, pass: s.pass }); } catch (e) { console.error(e); }
      store.emit('living');
    }) : null;
    this.preview.play();
    this.session.wall0 = performance.now();
    const tick = () => { if (!this.session) return; if (!store.playing) this.end(); else this.raf = requestAnimationFrame(tick); };
    this.raf = requestAnimationFrame(tick);
    // Esc belongs to the session while it runs: captured first and not passed on, or the timeline would also deselect the clip
    window.addEventListener('keydown', this._esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); this.cancel(); } }, true);
    store.emit('living');
    return true;
  }

  /** Stop and keep (REC pressed again, Space, or the timeline ended). */
  end() {
    const s = this.session;
    if (!s) return;
    const tEnd = Math.min(s.loop ? s.loop.b : projectDuration(store.project), this.clock());
    this._close();
    let result;
    try { result = s.handlers.finish({ tEnd }); } catch (e) { console.error(e); s.handlers.cancel?.(); store.dropSnapshot(); toast(`Could not keep the ${s.kind}: ${e.message}`, 'error'); store.emit('living'); return; }
    if (result.noop) store.dropSnapshot();
    this.last = { ...result, session: s.kind }; // `session` lets the UI offer to keep what was just performed
    store.touch('project', 'keyframes');
    store.emit('living');
  }

  /** Stop and throw away (Esc): everything goes back as it was. */
  cancel() {
    const s = this.session;
    if (!s) return;
    this._close();
    s.handlers.cancel?.();
    if (s.pass > 0) { const json = store.undoStack.pop(); if (json) store._restore(json, 'undo'); } // earlier passes were already written: put the whole project back as it was
    else store.dropSnapshot();
    this.last = { text: `The ${s.kind} was cancelled; nothing changed.` };
    store.touch('project', 'keyframes');
    store.emit('living');
  }

  _close() {
    this._offLoop?.(); this._offLoop = null; store.loopRange = null;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this._esc, true);
    this.session = null;
    this.preview.pause();
  }
}
