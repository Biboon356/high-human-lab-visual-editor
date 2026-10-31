// Lab Accident, the controller: plan a few accidents for the selected clips, keep one (one undo step), reroll one, undo the last kept.
// Planning and applying live in shared/living/accident.js and never touch the project; only keep() does, through store.mutate.
import { store } from '../store.js';
import { planAccidents } from '/shared/living/accident.js';
import { normalizeDna } from '/shared/mutation/dna.js';
import { newSeed } from '/shared/mutation/rng.js';

export class LabAccident {
  constructor() { this.items = []; this.lastKept = null; }

  _opts(extra = {}) {
    return { selection: [...store.multi], identity: normalizeDna(store.project.living?.dna).dna?.identity || null, ...extra };
  }

  /** New accidents for the project as it is now. Returns them (also kept in `items`). Changes nothing. */
  cause() { this.items = planAccidents(store.project, { seed: newSeed(), count: 3, ...this._opts() }); return this.items; }

  /** Another accident of the same kind as item i (or null when that kind no longer fits). */
  reroll(i) {
    const was = this.items[i];
    if (!was) return null;
    const [next] = planAccidents(store.project, { seed: newSeed(), kinds: [was.kind], count: 1, ...this._opts() });
    if (next) this.items[i] = next;
    return next || null;
  }

  /** Applies item i to the real project as one undo step. Returns false (and changes nothing) when it no longer applies. */
  keep(i) {
    const acc = this.items[i];
    if (!acc) return false;
    const probe = structuredClone(store.project);
    if (!acc.apply(probe)) return false;
    store.mutate((p) => { acc.apply(p); });
    this.lastKept = { summary: acc.summary, kind: acc.kind };
    this.items = [];
    return true;
  }

  /** Takes back the last kept accident (the editor's own Undo; it also takes back anything done after it, as Undo always does). */
  undo() { if (!this.lastKept || !store.undoStack.length) return false; store.undo(); this.lastKept = null; return true; }
}
