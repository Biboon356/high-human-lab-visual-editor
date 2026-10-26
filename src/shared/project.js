// Project model: plain JSON, no behaviour. Timeline mutations live in timeline.js.
export const PROJECT_VERSION = 1;

export const uid = (prefix = 'id') =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;

export const RESOLUTIONS = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '2160p': { width: 3840, height: 2160 },
  'square-1080': { width: 1080, height: 1080 },
  'vertical-1080': { width: 1080, height: 1920 },
};

export function createProject(name = 'Untitled Lab') {
  return {
    version: PROJECT_VERSION,
    name,
    settings: { width: 1920, height: 1080, fps: 30 },
    media: [],
    tracks: [
      { id: uid('trk'), name: 'V2', kind: 'video', muted: false, hidden: false },
      { id: uid('trk'), name: 'V1', kind: 'video', muted: false, hidden: false },
      { id: uid('trk'), name: 'A1', kind: 'audio', muted: false, hidden: false },
      { id: uid('trk'), name: 'A2', kind: 'audio', muted: false, hidden: false },
    ],
    clips: [],
    reactive: { enabled: true },
  };
}

export function defaultProps() {
  return { opacity: 1, x: 0, y: 0, scale: 1, rotation: 0, blend: 'normal', tracking: 0 };
}

export function createClip(fields) {
  return {
    id: uid('clip'),
    trackId: null,
    type: 'media', // 'media' | 'text' | 'generator'
    mediaId: null,
    name: '',
    start: 0,
    duration: 5,
    in: 0,
    volume: 1,
    props: defaultProps(),
    keyframes: {}, // propKey -> [{t, v}]  (t is clip-relative seconds)
    bindings: {}, // propKey -> {source, amount}
    effects: [],
    ...fields,
  };
}

export function findMedia(project, id) {
  return project.media.find((m) => m.id === id) || null;
}
export function findClip(project, id) {
  return project.clips.find((c) => c.id === id) || null;
}
export function findTrack(project, id) {
  return project.tracks.find((t) => t.id === id) || null;
}

/** Validates a loaded project; throws Error with a readable message. Returns the project. */
export function validateProject(p) {
  if (!p || typeof p !== 'object') throw new Error('Project file is not a JSON object.');
  if (typeof p.version !== 'number') throw new Error('Project file has no version field.');
  if (p.version > PROJECT_VERSION)
    throw new Error(`Project was saved by a newer version (v${p.version}); this build supports v${PROJECT_VERSION}.`);
  for (const k of ['media', 'tracks', 'clips']) {
    if (!Array.isArray(p[k])) throw new Error(`Project file is missing "${k}".`);
  }
  if (!p.settings || !(p.settings.width > 0) || !(p.settings.height > 0) || !(p.settings.fps > 0))
    throw new Error('Project settings are invalid.');
  const trackIds = new Set(p.tracks.map((t) => t.id));
  for (const c of p.clips) {
    if (!trackIds.has(c.trackId)) throw new Error(`Clip "${c.name || c.id}" references a missing track.`);
    c.props = { ...defaultProps(), ...(c.props || {}) };
    c.keyframes ||= {};
    c.bindings ||= {};
    c.effects ||= [];
    for (const fx of c.effects) {
      fx.params ||= {};
      fx.keyframes ||= {};
      fx.bindings ||= {};
    }
  }
  p.reactive ||= { enabled: true };
  return p;
}
