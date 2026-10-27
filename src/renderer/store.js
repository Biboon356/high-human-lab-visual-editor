// Central state + pub/sub + snapshot-based undo/redo. UI modules never talk to each other directly.
import { createProject, validateProject, findClip } from '/shared/project.js';
import { audioSources } from '/shared/export-plan.js';

const HISTORY_LIMIT = 100;

class Store {
  constructor() {
    this.project = createProject();
    this.filePath = null;
    this.dirty = false;
    this.selection = null; // primary clip id (what the Inspector shows)
    this.multi = new Set(); // every selected clip id (always includes the primary)
    this.playhead = 0;
    this.playing = false;
    this.zoom = 60; // px per second
    this.analysis = null;
    this.analysisStale = true;
    this.analysisSig = null;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Map();
    this.pendingSnap = null;
    this.clipboard = null; // copied clip (JSON)
    this.relinkedMedia = null;
  }

  on(topic, fn) {
    if (!this.listeners.has(topic)) this.listeners.set(topic, new Set());
    this.listeners.get(topic).add(fn);
    return () => this.listeners.get(topic).delete(fn);
  }
  emit(...topics) {
    for (const t of topics) for (const fn of this.listeners.get(t) || []) fn();
  }

  get selectedClip() { return this.selection ? findClip(this.project, this.selection) : null; }

  /** Take an undo snapshot once per gesture; subsequent calls with same token are ignored. */
  snapshot() {
    this.undoStack.push(JSON.stringify(this.project));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Discrete edit: snapshot, mutate, notify. */
  mutate(fn, ...topics) {
    this.snapshot();
    const r = fn(this.project);
    this.touch(...(topics.length ? topics : ['project']));
    return r;
  }

  /** Notify after an in-place change (used inside gestures). Marks the project dirty and the audio analysis stale. */
  touch(...topics) {
    this.setDirty(true);
    if (topics.includes('project')) this.analysisStale = this.audioSignature() !== this.analysisSig;
    this.emit(...topics, 'render');
  }

  /** Fingerprint of everything that changes the audio mix (and therefore the analysis). */
  audioSignature() {
    return JSON.stringify(audioSources(this.project).map(({ clip, media }) => [media.path, clip.start, clip.in, clip.duration, clip.volume]));
  }

  setDirty(d) {
    if (this.dirty !== d) { this.dirty = d; this.emit('dirty'); }
  }

  _restore(json) {
    this.project = JSON.parse(json);
    if (this.selection && !findClip(this.project, this.selection)) this.selection = null;
    this.multi = new Set([...this.multi].filter((id) => findClip(this.project, id)));
    if (this.selection) this.multi.add(this.selection);
    this.analysisStale = this.audioSignature() !== this.analysisSig;
    this.setDirty(true);
    this.emit('project', 'selection', 'render');
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.project));
    this._restore(this.undoStack.pop());
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.project));
    this._restore(this.redoStack.pop());
  }

  loadProject(project, filePath = null) {
    this.project = validateProject(project);
    this.filePath = filePath;
    this.selection = null;
    this.multi = new Set();
    this.playhead = 0;
    this.playing = false;
    this.undoStack = []; this.redoStack = [];
    this.analysis = null; this.analysisStale = true; this.analysisSig = null;
    this.dirty = false;
    this.emit('project', 'selection', 'playhead', 'analysis', 'dirty', 'render', 'reset');
  }

  select(id) {
    const same = this.selection === id && this.multi.size === (id ? 1 : 0);
    this.selection = id;
    this.multi = new Set(id ? [id] : []);
    if (!same) this.emit('selection', 'render');
  }

  /** Shift/Ctrl-click: add or remove a clip from the selection. */
  toggleSelect(id) {
    if (this.multi.has(id)) { this.multi.delete(id); if (this.selection === id) this.selection = [...this.multi].pop() ?? null; }
    else { this.multi.add(id); this.selection = id; }
    this.emit('selection', 'render');
  }
  setPlayhead(t) {
    this.playhead = Math.max(0, t);
    this.emit('playhead', 'render');
  }
}

export const store = new Store();
