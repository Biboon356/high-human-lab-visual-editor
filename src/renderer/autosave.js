// Crash recovery. While there are unsaved changes the project is written to the app-data folder every few seconds;
// a normal save, New, or a clean exit clears it. On the next start, an existing autosave is offered for restore.
import { store } from './store.js';
import { toast } from './ui/dom.js';

const INTERVAL_MS = 8000;
let timer = null;
let lastWritten = '';

const snapshot = () => {
  const p = structuredClone(store.project);
  for (const m of p.media) delete m.missing;
  return JSON.stringify(p);
};

export async function writeNow() {
  if (!store.dirty) return false;
  const json = snapshot();
  if (json === lastWritten) return false;
  try { await window.hh.autosaveWrite(json); lastWritten = json; return true; } catch { return false; /* best effort */ }
}

export function startAutosave() {
  clearInterval(timer);
  timer = setInterval(writeNow, INTERVAL_MS);
  // a saved project makes the autosave obsolete
  store.on('dirty', () => { if (!store.dirty) { lastWritten = ''; window.hh.autosaveClear().catch(() => {}); } });
}

/** Offers to restore unsaved work from a previous session. Returns true if the project was restored. */
export async function offerRecovery({ startup = false } = {}) {
  const found = await window.hh.autosaveRead({ startup });
  if (!found) return false;
  const when = new Date(found.savedAt).toLocaleString();
  const media = found.project.media.length;
  if (!confirm(`Restore unsaved work from ${when}?\n\n"${found.project.name}" · ${found.project.clips.length} clips · ${media} media files\n\nOK = restore, Cancel = discard it.`)) {
    await window.hh.autosaveClear();
    return false;
  }
  store.loadProject(found.project, null);
  store.setDirty(true);
  toast('Restored your unsaved project. Save it with Ctrl/Cmd+S.');
  return true;
}
