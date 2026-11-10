// Taste Brain (renderer side): remembers, in this computer's local storage only, which effects the artist applies, cancels or undoes at once, and answers
// "does this fit?". It never applies anything. Switch it off and it stops recording; "Forget everything" empties it. Storage failing must never matter.
import { store } from './store.js';
import { cleanProfile, emptyProfile, recordEvent, fit, summarize, weights, REGRET_WINDOW_MS } from '/shared/taste/taste.js';

const KEY = 'hhlab.taste.v1', ON = 'hhlab.taste.on';
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

function load() { try { return cleanProfile(JSON.parse(read(KEY) || 'null')); } catch { return emptyProfile(); } }

export const taste = {
  profile: load(),
  enabled: read(ON) !== '0',
  clock: () => Date.now(),
  last: null, // the latest Apply, so an Undo right after it can be counted as "I did not want that"
  listeners: new Set(),
  _save() { write(KEY, JSON.stringify(this.profile)); for (const f of this.listeners) { try { f(); } catch (e) { console.error(e); } } },
  setEnabled(on) { this.enabled = !!on; write(ON, on ? '1' : '0'); this._save(); },
  record(kind, tags) { if (!this.enabled) return; this.profile = recordEvent(this.profile, { kind, tags, at: this.clock() }); this._save(); },
  /** After the artist pressed APPLY on a preview that carried `taste.tags`. */
  noteApplied(spec) { const tags = spec?.taste?.tags; if (!tags?.length) return; this.record('applied', tags); this.last = this.enabled ? { tags, at: this.clock(), depth: store.undoStack.length } : null; },
  noteCancelled(spec) { const tags = spec?.taste?.tags; if (tags?.length) this.record('cancelled', tags); this.last = null; },
  /** An Undo that removes exactly that Apply, soon after it, says it was not wanted. */
  noteUndo() { const l = this.last; if (!l || !this.enabled) return; this.last = null; if (this.clock() - l.at <= REGRET_WINDOW_MS && store.undoStack.length === l.depth - 1) this.record('regret', l.tags); },
  forget() { this.profile = emptyProfile(); this.last = null; this._save(); },
  summary() { return summarize(this.profile, this.clock()); },
  /** How well these effects fit; null unless it has enough evidence (silence is the default). */
  fit(effectNames) { return this.enabled ? fit(this.profile, effectNames.map((t) => `fx:${t}`), this.clock()) : null; },
  weights() { return this.enabled ? weights(this.profile, this.clock()) : {}; },
};
store.on('project', () => { if (store.changeKind === 'undo') taste.noteUndo(); else if (store.changeKind === 'edit' && taste.last && store.undoStack.length !== taste.last.depth) taste.last = null; });
