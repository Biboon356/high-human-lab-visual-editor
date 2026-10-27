import { store } from './store.js';
import { toast } from './ui/dom.js';
import { createProject } from '/shared/project.js';
import { mountPreview } from './ui/preview.js';
import { mountTimeline, splitSelected, deleteSelected, duplicateSelected, copySelected, pasteClip, cutOnBeats, autoMontage } from './ui/timeline-ui.js';
import { mountInspector } from './ui/inspector.js';
import { mountMediaBin, importResults } from './ui/media-bin.js';
import { mountReactive, runAnalysis } from './ui/reactive-ui.js';
import { mountProjectSettings } from './ui/project-settings.js';
import { openExportDialog, isExporting } from './ui/export-dialog.js';
import { renderProject } from './engine/exporter.js';
import { renderStill } from './engine/still.js';
import { startRoots } from './bg-roots.js';
import { startAutosave, offerRecovery, writeNow } from './autosave.js';

const $ = (id) => document.getElementById(id);
const hh = window.hh;

// ---- theme + panels
const THEME_KEY = 'hhlab.theme';
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* storage unavailable */ }
}
try { setTheme(localStorage.getItem(THEME_KEY) || 'dark'); } catch { setTheme('dark'); }
$('toggle-theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
for (const [btn, cls] of [['toggle-left', 'no-left'], ['toggle-right', 'no-right'], ['toggle-timeline', 'no-tl']]) {
  $(btn).onclick = () => { $('app').classList.toggle(cls); dispatchEvent(new Event('resize')); };
}
document.querySelectorAll('[data-tabs]').forEach((nav) => {
  const side = nav.dataset.tabs;
  nav.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    nav.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll(`#panel-${side} [data-pane]`).forEach((p) => p.classList.toggle('on', p.dataset.pane === b.dataset.tab));
    store.emit('playhead');
  }));
});

// ---- project actions
async function importMedia() {
  const results = await hh.pickMedia();
  if (results.length) await importResults(results);
}
async function newProject() {
  if (store.dirty && !confirm('Discard unsaved changes?')) return;
  store.loadProject(createProject());
}
function stripTransient(p) {
  const c = structuredClone(p);
  for (const m of c.media) delete m.missing;
  return c;
}
async function save(saveAs = false) {
  try {
    const r = await hh.saveProject(stripTransient(store.project), store.filePath, saveAs);
    if (!r) return false;
    store.filePath = r.filePath;
    store.setDirty(false);
    toast(`Saved ${r.filePath}`);
    return true;
  } catch (e) { toast(`Save failed: ${e.message}`, 'error'); return false; }
}
async function openProject() {
  if (store.dirty && !confirm('Discard unsaved changes?')) return;
  try {
    const r = await hh.openProject();
    if (!r) return;
    for (const m of r.project.media) if (r.missing.includes(m.id)) m.missing = true;
    store.loadProject(r.project, r.filePath);
    if (r.missing.length) toast(`${r.missing.length} media file(s) could not be found; those clips are marked missing.`, 'error');
    else toast(`Opened ${r.project.name}`);
  } catch (e) { toast(e.message, 'error'); }
}

const actions = {
  new: newProject, open: openProject, save: () => save(false), saveAs: () => save(true),
  import: importMedia, export: openExportDialog,
  undo: () => store.undo(), redo: () => store.redo(), duplicate: duplicateSelected,
};
document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.act]()));
hh.onMenu((a) => actions[a]?.());

// ---- project name + dirty
const nameIn = $('project-name');
nameIn.addEventListener('input', () => { store.project.name = nameIn.value; store.touch(); });
function syncChrome() {
  if (document.activeElement !== nameIn) nameIn.value = store.project.name;
  $('dirty-dot').hidden = !store.dirty;
  hh.setDirty(store.dirty, store.project.name || 'Untitled');
}
store.on('dirty', syncChrome); store.on('reset', syncChrome); store.on('project', syncChrome);

// ---- mount modules
const preview = mountPreview();
const timeline = mountTimeline();
mountInspector($('inspector'));
mountMediaBin({ onImport: importResults });
mountReactive($('reactive'));
mountProjectSettings($('project-settings'));
startRoots($('bg-roots'), () => store.playing || isExporting());
syncChrome();
startAutosave();
offersRecovery();
async function offersRecovery() { try { await offerRecovery({ startup: true }); } catch { /* never block startup */ } }

$('t-still').onclick = async () => {
  try {
    const blob = await renderStill(structuredClone(store.project), store.playhead, store.analysis);
    const file = await hh.savePng(await blob.arrayBuffer(), `${store.project.name || 'frame'}-${store.playhead.toFixed(2)}s`);
    if (file) toast(`Saved ${file}`);
  } catch (e) { toast(`Could not save the frame: ${e.message}`, 'error'); }
};

// ---- keyboard
addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && !(tag === 'INPUT' && ['range', 'checkbox'].includes(document.activeElement.type))) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return; // menu accelerators own these
  const fps = store.project.settings.fps;
  switch (e.key) {
    case ' ': e.preventDefault(); preview.toggle(); break;
    case 's': case 'S': splitSelected(); break;
    case 'Delete': case 'Backspace': e.preventDefault(); deleteSelected({ ripple: e.shiftKey }); break;
    case 'ArrowLeft': e.preventDefault(); preview.pause(); store.setPlayhead(store.playhead - (e.shiftKey ? 1 : 1 / fps)); break;
    case 'ArrowRight': e.preventDefault(); preview.pause(); store.setPlayhead(store.playhead + (e.shiftKey ? 1 : 1 / fps)); break;
    case 'Home': store.setPlayhead(0); break;
    case '+': case '=': timeline.setZoom(store.zoom * 1.25); break;
    case '-': timeline.setZoom(store.zoom / 1.25); break;
    default: break;
  }
});
addEventListener('error', (e) => toast(`Unexpected error: ${e.message}`, 'error'));
addEventListener('unhandledrejection', (e) => toast(`Unexpected error: ${e.reason?.message || e.reason}`, 'error'));

// Clip copy/paste rides on the native Edit menu's copy/paste events, so text fields keep normal behaviour.
const inTextField = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !['range', 'checkbox'].includes(document.activeElement.type);
document.addEventListener('copy', (e) => { if (!inTextField() && copySelected()) { e.preventDefault(); toast('Clip copied.'); } });
document.addEventListener('paste', (e) => { if (!inTextField() && store.clipboard) { e.preventDefault(); pasteClip(); } });

// ---- automation hook (used by scripts/e2e.mjs; harmless in normal use)
window.__app = {
  store, preview, timeline, autosave: { writeNow, offerRecovery }, runAnalysis, cutOnBeats, autoMontage, importPaths: async (paths) => importResults(await hh.probePaths(paths)),
  exportTo: async (outPath, overrides = {}) => {
    const s = store.project.settings;
    const settings = { width: s.width, height: s.height, fps: s.fps, quality: 'draft', format: outPath.endsWith('.webm') ? 'webm' : 'mp4', ...overrides, outPath };
    if (JSON.stringify(store.project).includes('"bindings":{"') && (store.analysisStale || !store.analysis)) await runAnalysis({ quiet: true });
    return renderProject({ project: structuredClone(store.project), settings, analysis: store.analysis, onProgress: () => {}, signal: { cancelled: false } });
  },
};
