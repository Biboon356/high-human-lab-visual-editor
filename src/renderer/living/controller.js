// LivingLabController: the one place that knows whether a recording session (a take or a trace) is running. Both sessions work the
// same way: remember an undo point, play the timeline from the playhead, collect what the hand does, and when playback stops hand the
// result to the module that knows how to turn it into ordinary keyframes or a clip. It keeps no state of its own about the project.
import { store } from '../store.js';
import { toast } from '../ui/dom.js';
import { projectDuration } from '/shared/timeline.js';
import { LabTake } from './lab-take.js';
import { HumanTrace } from './human-trace.js';
import { LabAccident } from './lab-accident.js';

export class LivingLabController {
  constructor({ preview }) {
    this.preview = preview;
    this.session = null;
    this.settings = { smooth: 0.25 }; // 0..1, shared by take and trace
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

  begin(kind, handlers) {
    if (this.session) return false;
    const dur = projectDuration(store.project);
    if (dur <= 0) { toast('Put something on the timeline first.', 'error'); return false; }
    store.snapshot(); // one undo step for the whole session
    const t0 = store.playhead >= dur - 0.05 ? 0 : store.playhead;
    store.setPlayhead(t0);
    this.session = { kind, t0, wall0: performance.now(), handlers };
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
    const tEnd = Math.min(projectDuration(store.project), this.clock());
    this._close();
    let result;
    try { result = s.handlers.finish({ tEnd }); } catch (e) { console.error(e); s.handlers.cancel?.(); store.dropSnapshot(); toast(`Could not keep the ${s.kind}: ${e.message}`, 'error'); store.emit('living'); return; }
    if (result.noop) store.dropSnapshot();
    this.last = result;
    store.touch('project', 'keyframes');
    store.emit('living');
  }

  /** Stop and throw away (Esc): everything goes back as it was. */
  cancel() {
    const s = this.session;
    if (!s) return;
    this._close();
    s.handlers.cancel?.();
    store.dropSnapshot();
    this.last = { text: `The ${s.kind} was cancelled; nothing changed.` };
    store.touch('project', 'keyframes');
    store.emit('living');
  }

  _close() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this._esc, true);
    this.session = null;
    this.preview.pause();
  }
}
