// The Lab Take: perform controls while the timeline runs; the performance becomes ordinary keyframes (shared/living/take.js).
// Sources of movement: any Inspector slider (captured in ui/param-row.js) and the pad in the Living tab. A MIDI source would call
// perform() the same way; none is built.
import { store } from '../store.js';
import { TakeRecorder } from '/shared/living/take.js';
import { setKey } from '/shared/keyframes.js';

export class LabTake {
  constructor(ctrl) { this.ctrl = ctrl; this.rec = new TakeRecorder(); this.passes = []; }

  get active() { return this.rec.active; }

  start() {
    this.passes = [];
    const ok = this.ctrl.begin('take', { finish: (o) => this._finish(o), cancel: () => this._cancel(), pass: (o) => this._pass(o) });
    if (!ok) return false;
    this.rec.clock = () => this.ctrl.clock();
    this.rec.start(this.ctrl.session.t0);
    store.recorder = this.rec; // param-row.js reports every value change to it
    return true;
  }

  /** The loop came round: what was performed so far becomes ordinary keyframes (so the next pass plays it back), and recording starts again. */
  _pass({ tEnd }) {
    const r = this.rec.finish({ tEnd, ...this.ctrl.curve() });
    this.passes.push(r);
    this.rec.start(this.ctrl.session.t0);
  }

  _finish({ tEnd }) {
    store.recorder = null;
    const r = this.rec.finish({ tEnd, ...this.ctrl.curve() });
    const all = [...this.passes, r]; this.passes = [];
    if (!all.some((x) => x.parameters)) return { noop: true, text: 'Nothing was touched during the take, so nothing was recorded.' };
    const tail = 'They are ordinary keyframes — edit them in the Inspector, or Undo to remove the take.';
    if (all.length === 1) return { text: `Take kept: ${r.parameters} parameter${r.parameters === 1 ? '' : 's'}, ${r.keys} keyframes. ${tail}` };
    const keys = all.reduce((n, x) => n + x.keys, 0);
    return { text: `Take kept over ${all.length} passes (a later pass replaces an earlier one where they overlap): ${keys} keyframes. ${tail}` };
  }

  _cancel() { store.recorder = null; this.rec.cancel(); this.passes = []; }

  /** Sets a slot's value from a hand: recorded when a take is running, otherwise it behaves like moving the Inspector slider. */
  perform(slot, v) {
    v = Math.min(slot.def.max, Math.max(slot.def.min, v));
    const rec = store.recorder;
    if (rec?.active) {
      const now = this.ctrl.clock();
      rec.capture({ owner: slot.owner, key: slot.key, v, t: now - slot.start, now, def: slot.def });
      slot.setBase(v);
    } else if (slot.owner.keyframes?.[slot.key]?.length) {
      slot.owner.keyframes[slot.key] = setKey(slot.owner.keyframes[slot.key], store.playhead - slot.start, v); // auto-key, like the row
    } else slot.setBase(v);
    store.touch('render');
  }
}
