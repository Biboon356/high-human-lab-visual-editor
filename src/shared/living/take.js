// The Lab Take: perform controls while the timeline runs, and keep the performance as ordinary keyframes.
// Pure (no DOM): the UI calls capture() from the places a value changes and finish() when the take stops.
//
// While a take is running, a parameter you touch is "taken over": its existing keyframes are set aside so your hand is what you see
// and hear. When the take ends, the performance is simplified and punched over the stretch you played; the old keys before and after
// it come back. cancel() puts everything back exactly as it was.
import { simplifyTrack, smoothValues, punchMerge } from './simplify.js';

const HOLD_GAP = 0.25; // seconds without movement that count as "resting" (kept as a flat stretch, not as a slow glide)

export class TakeRecorder {
  constructor() { this.active = false; this.slots = new Map(); this.t0 = 0; }

  start(timelineTime) { this.active = true; this.slots = new Map(); this.t0 = timelineTime; }

  /**
   * @param o {owner (object with keyframes{}), key, v, t (the owner's own time in seconds), now (timeline time), def {min,max}}
   * Call BEFORE writing the new value; the first call for a parameter sets its old keyframes aside.
   */
  capture({ owner, key, v, t, now, def }) {
    if (!this.active || !Number.isFinite(v) || !Number.isFinite(t)) return;
    let perOwner = this.slots.get(owner);
    if (!perOwner) { perOwner = new Map(); this.slots.set(owner, perOwner); }
    let slot = perOwner.get(key);
    if (!slot) {
      slot = { stash: owner.keyframes?.[key] ? structuredClone(owner.keyframes[key]) : null, samples: [], offset: now - t, range: [def.min, def.max] };
      perOwner.set(key, slot);
      if (owner.keyframes) delete owner.keyframes[key];
    }
    slot.samples.push({ t, v });
  }

  get touched() { let n = 0; for (const m of this.slots.values()) n += m.size; return n; }

  /** Gives every taken-over parameter its old keyframes back; nothing of the take remains. */
  cancel() {
    for (const [owner, m] of this.slots) for (const [key, slot] of m) {
      owner.keyframes ||= {};
      if (slot.stash) owner.keyframes[key] = slot.stash; else delete owner.keyframes[key];
    }
    this.active = false; this.slots = new Map();
  }

  /**
   * @param o {tEnd (timeline time the take stopped), tol, smooth}
   * @returns {{parameters:number, keys:number, details:{key:string, keys:number}[]}}
   */
  finish({ tEnd, tol = 0.02, smooth = 0.25 } = {}) {
    const details = [];
    let keys = 0;
    for (const [owner, m] of this.slots) for (const [key, slot] of m) {
      let s = slot.samples.slice().sort((a, b) => a.t - b.t);
      if (!s.length) continue;
      const withHolds = [];
      s.forEach((p, i) => {
        if (i > 0 && p.t - s[i - 1].t > HOLD_GAP) withHolds.push({ t: p.t - 0.04, v: s[i - 1].v }); // rest, then move
        withHolds.push(p);
      });
      const endLocal = Number.isFinite(tEnd) ? tEnd - slot.offset : withHolds.at(-1).t;
      if (endLocal > withHolds.at(-1).t + 0.04) withHolds.push({ t: endLocal, v: withHolds.at(-1).v }); // it stays where you left it
      const first = withHolds[0].t;
      if (first > 0.04 && !slot.stash) withHolds.unshift({ t: Math.max(0, first - 0.04), v: withHolds[0].v });
      const track = simplifyTrack(smoothValues(withHolds, smooth), { tol, range: slot.range });
      owner.keyframes ||= {};
      owner.keyframes[key] = punchMerge(slot.stash, track, track[0].t, track.at(-1).t);
      keys += track.length;
      details.push({ key, keys: track.length });
    }
    const parameters = this.touched;
    this.active = false; this.slots = new Map();
    return { parameters, keys, details };
  }
}
