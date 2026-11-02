// The Creative Memory Engine in the app: ONE shared foundation that watches the project (observe), works out what the artist is doing
// (understand) and keeps what is worth keeping (Still Here). Everything creative that builds on it (the Living Timeline, suggestions, the
// Living Lab tools) is meant to read from here instead of growing its own watcher.
//
// Rules this file enforces:
//   - event driven and debounced: it looks once after a quiet moment, never per frame, and it does nothing to the picture;
//   - it never edits the project by itself except to put a fragment on the Still Here shelf (which is outside undo and is removable);
//   - if anything in it throws, the editor carries on: three failures in a row switch the engine off for the session.
import { store } from '../store.js';
import { Observer } from '/shared/creative/observe.js';
import { inferContext } from '/shared/creative/context.js';
import { captureMemory, applyMemory, addMemory, removeMemory, renameMemory, attachThumb, shelfOf, curate, knownHashes } from '/shared/creative/still-here.js';
import { builtinDna, chainHash, normalizeDna } from '/shared/mutation/dna.js';
import { newSeed } from '/shared/mutation/rng.js';
import { planRelationChain } from '/shared/creative/relate.js';
import { planRelation } from '/shared/creative/relate.js';
import { suggestFor } from '/shared/creative/suggest.js';
import { evaluate, GATE, cleanStats, recordShown, recordApplied, recordDismissed } from '/shared/creative/gate.js';

const OFF_KEY = 'hhlab.creative'; // 'off' switches the whole engine off (a developer switch; the editor works the same without it)
const AUTO_KEY = 'hhlab.stillhere.auto'; // 'off' = never keep anything by itself
const SUGGEST_KEY = 'hhlab.suggest'; // 'off' = never suggest (the manual tools stay)
const STATS_KEY = 'hhlab.gate.stats'; // how often suggestions were shown, dismissed and applied (the gate learns from it)
const QUIET_MS = 600;
const SUGGESTION_LIFE_MS = 25000; // a suggestion that is left alone fades away by itself
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

export class CreativeMemoryEngine {
  constructor() {
    this.observer = new Observer();
    this.context = { kind: 'idle', clipIds: [], why: '' };
    this.enabled = read(OFF_KEY, 'on') !== 'off';
    this.autoKeep = read(AUTO_KEY, 'on') !== 'off';
    this.failures = 0;
    this.clock = () => Date.now(); // tests replace it
    this._timer = 0;
    this._silent = false;
    this._started = false;
    this._builtin = null;
    // ---- Decision Gate state: at most ONE suggestion is ever active
    this.suggestOn = read(SUGGEST_KEY, 'on') !== 'off';
    this.suggestion = null;
    this.cooldowns = {};
    this.lastShownAt = -Infinity;
    this.lastEditAt = -Infinity;
    this.busyProbe = () => false; // the Living Lab says when a take or trace is running
    this._sTimer = 0;
    this.stats = (() => { try { return cleanStats(JSON.parse(read(STATS_KEY, 'null'))); } catch { return cleanStats(null); } })();
  }

  start() {
    if (this._started) return;
    this._started = true;
    store.on('project', () => this._mark());
    store.on('selection', () => { this._refreshContext(); this.revalidate(); this._scheduleSuggest(); });
    this._refreshContext();
  }

  // ---- observe -> understand -> keep ----

  _mark() {
    if (!this.enabled) return;
    if (store.changeKind !== 'edit') this._silent = true; // undo, redo and loading are not abandoned work
    this.lastEditAt = this.clock();
    this.revalidate();
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), QUIET_MS);
  }

  /** Looks at the project now (normally called after a quiet moment; tests call it directly). */
  flush() {
    clearTimeout(this._timer);
    if (!this.enabled) return;
    try {
      const silent = this._silent; this._silent = false;
      const now = this.clock();
      const { ended } = this.observer.update(store.project, now, { silent });
      if (!silent && this.autoKeep && ended.length) this._curate(ended, now);
      this._refreshContext();
      this._scheduleSuggest();
      this.failures = 0;
    } catch (e) {
      console.error('[creative]', e);
      if (++this.failures >= 3) { this.enabled = false; console.error('[creative] switched off for this session after repeated failures; the editor is unaffected'); }
    }
  }

  _curate(ended, now) {
    this._builtin ||= (() => { try { return builtinDna().map((d) => chainHash(d.chain)); } catch { return []; } })();
    const known = knownHashes(store.project, this._builtin);
    let added = 0;
    for (const e of ended) {
      const r = curate(e, { now, known });
      if (!r.keep) continue;
      if (addMemory(store.project, r.keep).added) { added++; known.add(r.keep.sig); }
    }
    if (added) store.touch('stillhere'); // saved with the project, not an undo step
  }

  _refreshContext() {
    if (!this.enabled) return;
    try {
      const next = inferContext({ project: store.project, selection: [...store.multi], recent: this.observer.recent, now: this.clock() });
      const same = next.kind === this.context.kind && next.clipIds.join() === this.context.clipIds.join();
      this.context = next;
      if (!same) store.emit('creative');
    } catch (e) { console.error('[creative]', e); }
  }

  // ---- Living Timeline: manual relations between two clips ----

  identity() { try { return normalizeDna(store.project.living?.dna).dna?.identity || null; } catch { return null; } }

  /** Plans FOLLOW / GROW FROM / REMEMBER / BECOME between two selected clips. Changes nothing. */
  planRelation(kind, ids = [...store.multi], seed = newSeed()) {
    if (ids.length < 2) return { reason: 'Select two clips, or more to chain them.' };
    return planRelationChain(store.project, kind, ids, { seed, identity: this.identity() });
  }

  /** Applies a plan as ONE undo step; nothing changes (and no empty step is left) when it no longer applies. */
  applyPlan(plan) {
    const probe = structuredClone(store.project);
    if (!plan.apply(probe)) return false;
    store.snapshot();
    plan.apply(store.project);
    store.touch('project', 'keyframes');
    return true;
  }

  // ---- the Decision Gate: suggestions, one at a time, nearly always none ----

  typing() {
    const a = document.activeElement;
    return !!a && (a.isContentEditable || a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'color'].includes(a.type)));
  }
  _gateState(now) {
    return { now, enabled: this.enabled && this.suggestOn, context: this.context, selection: [...store.multi], playing: !!store.playing, busy: !!(this.busyProbe() || store.recorder),
      typing: this.typing(), lastEditAt: this.lastEditAt, active: !!this.suggestion, lastShownAt: this.lastShownAt, cooldowns: this.cooldowns, stats: this.stats };
  }
  _saveStats() { write(STATS_KEY, JSON.stringify(this.stats)); }
  _scheduleSuggest() {
    if (!this.enabled || !this.suggestOn) return;
    clearTimeout(this._sTimer);
    this._sTimer = setTimeout(() => this.suggestNow(), GATE.quietMs + 150);
  }

  /** Asks the gate about what the context offers. Most of the time this returns null: that is the design. */
  suggestNow() {
    if (!this.enabled || !this.suggestOn || this.suggestion) return this.suggestion;
    try {
      const now = this.clock();
      for (const c of suggestFor({ project: store.project, context: this.context, shelf: this.shelf, identity: this.identity() })) {
        if (!evaluate(c, this._gateState(now)).pass) continue;
        this.suggestion = { ...c, shownAt: now, seed: newSeed() }; // one seed: what the preview shows is what Apply makes
        this.lastShownAt = now;
        this.stats = recordShown(this.stats); this._saveStats();
        store.emit('suggestion');
        return this.suggestion;
      }
    } catch (e) { console.error('[creative]', e); }
    return null;
  }

  /** Takes the suggestion away without any penalty when the moment has passed (playing, typing, the artist moved on) or after it faded. */
  revalidate() {
    const s = this.suggestion;
    if (!s) return;
    const now = this.clock(), here = new Set([...store.multi, ...this.context.clipIds]);
    const gone = store.playing || this.busyProbe() || store.recorder || this.typing() || !s.contexts.includes(this.context.kind) || !s.clipIds.every((id) => here.has(id) && store.project.clips.some((c) => c.id === id));
    if (gone) return this._withdraw();
    if (now - s.shownAt > SUGGESTION_LIFE_MS) { this.cooldowns[s.key] = now + GATE.ignoredCooldownMs; this.lastShownAt = now; this._withdraw(); }
  }
  _withdraw() { this.suggestion = null; store.emit('suggestion'); }

  /** The artist accepts. @returns {{ok, text?, reason?}} */
  applySuggestion(itemId = null) {
    const s = this.suggestion;
    if (!s) return { ok: false, reason: 'That suggestion is gone.' };
    let r;
    if (s.kind === 'relate') {
      const plan = planRelation(store.project, s.relation, s.clipIds[0], s.clipIds[1], { seed: s.seed, identity: this.identity() });
      r = plan.reason ? { ok: false, reason: plan.reason } : this.applyPlan(plan) ? { ok: true, text: plan.summary } : { ok: false, reason: 'It no longer applies.' };
    } else r = this.bringBack(itemId || s.items[0].id, s.clipIds);
    if (r.ok) { this.stats = recordApplied(this.stats); this._saveStats(); this.cooldowns[s.key] = Infinity; }
    this._withdraw();
    return r;
  }

  /** Shows what Apply would do, in the monitor (press Space to play it). The suggestion counts as applied only if the artist applies the preview. */
  previewSuggestion(itemId = null) {
    const s = this.suggestion;
    if (!s) return false;
    const after = () => { this.stats = recordApplied(this.stats); this._saveStats(); this.cooldowns[s.key] = Infinity; };
    if (s.kind === 'relate') {
      const plan = planRelation(store.project, s.relation, s.clipIds[0], s.clipIds[1], { seed: s.seed, identity: this.identity() });
      if (plan.reason) return false;
      const ok = store.showGhost({ label: s.heading, apply: (p) => plan.apply(p), done: `${plan.summary} Undo takes it back.`, after });
      if (ok) store.setPlayhead(Math.max(0, plan.at - 0.5));
      return ok;
    }
    const m = this.shelf.find((x) => x.id === (itemId || s.items[0].id));
    if (!m) return false;
    return store.showGhost({ label: `${s.heading} · ${m.name}`, apply: (p) => applyMemory(p, m, { clipIds: s.clipIds }).ok, done: 'Brought back. Undo takes it back.', after });
  }

  /** The artist says no. The same thing is not offered again for a while, and the bar rises if this keeps happening. */
  dismissSuggestion() {
    const s = this.suggestion;
    if (!s) return;
    const now = this.clock();
    this.stats = recordDismissed(this.stats, now); this._saveStats();
    this.cooldowns[s.key] = now + GATE.dismissCooldownMs;
    this.lastShownAt = now;
    this._withdraw();
  }

  setSuggestions(on) { this.suggestOn = !!on; write(SUGGEST_KEY, on ? 'on' : 'off'); if (!on && this.suggestion) this._withdraw(); store.emit('stillhere'); }

  // ---- Still Here ----

  get shelf() { return shelfOf(store.project); }
  setAutoKeep(on) { this.autoKeep = !!on; write(AUTO_KEY, on ? 'on' : 'off'); store.emit('stillhere'); }

  /** What could be kept from this selection, kind by kind: {kind: {ok, reason}}. */
  availability(clipIds = [...store.multi]) {
    const out = {};
    for (const kind of ['moved', 'looked', 'felt', 'rhythm']) { const r = captureMemory(store.project, { kind, clipIds, now: 0 }); out[kind] = r.memory ? { ok: true } : { ok: false, reason: r.reason }; }
    return out;
  }

  /** The artist keeps something. @returns {{ok, memory?, reason?, existing?}} */
  keep(kind, clipIds = [...store.multi]) {
    const r = captureMemory(store.project, { kind, clipIds, now: this.clock() });
    if (!r.memory) return { ok: false, reason: r.reason };
    const a = addMemory(store.project, r.memory);
    if (!a.added) return { ok: false, reason: a.reason, existing: a.existing };
    store.touch('stillhere');
    return { ok: true, memory: a.memory };
  }

  /** Brings a fragment back onto the selection as ONE undo step. Nothing changes when it cannot be applied. */
  bringBack(id, clipIds = [...store.multi]) {
    const m = this.shelf.find((x) => x.id === id);
    if (!m) return { ok: false, reason: 'That memory is gone.' };
    store.snapshot();
    let r;
    try { r = applyMemory(store.project, m, { clipIds }); } catch (e) { console.error('[creative]', e); r = { ok: false, reason: 'Could not bring it back.' }; }
    if (!r.ok) { store.dropSnapshot(); return r; }
    store.touch('project', 'keyframes');
    return r;
  }

  letGo(id) { if (removeMemory(store.project, id)) { store.touch('stillhere'); return true; } return false; }
  rename(id, name) { if (renameMemory(store.project, id, name)) { store.touch('stillhere'); return true; } return false; }
  thumb(id, dataUrl) { if (attachThumb(store.project, id, dataUrl)) { store.touch('stillhere'); return true; } return false; }
}

export const creative = new CreativeMemoryEngine();
