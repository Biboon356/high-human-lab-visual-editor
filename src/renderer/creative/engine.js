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
import { builtinDna, chainHash } from '/shared/mutation/dna.js';

const OFF_KEY = 'hhlab.creative'; // 'off' switches the whole engine off (a developer switch; the editor works the same without it)
const AUTO_KEY = 'hhlab.stillhere.auto'; // 'off' = never keep anything by itself
const QUIET_MS = 600;
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
  }

  start() {
    if (this._started) return;
    this._started = true;
    store.on('project', () => this._mark());
    store.on('selection', () => this._refreshContext());
    this._refreshContext();
  }

  // ---- observe -> understand -> keep ----

  _mark() {
    if (!this.enabled) return;
    if (store.changeKind !== 'edit') this._silent = true; // undo, redo and loading are not abandoned work
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
