import { reverseSelected, freezeAtPlayhead } from './engine/edit-tools.js';
import { placeAdlibs, stutterAtPlayhead } from './engine/rhythm-tools.js';
import { mountPreviewEdit } from './ui/preview-edit.js';
import { store } from './store.js';
import { toast } from './ui/dom.js';
import { createProject } from '/shared/project.js';
import { mountPreview } from './ui/preview.js';
import { mountTimeline, setMark, clearRange, splitSelected, deleteSelected, duplicateSelected, copySelected, pasteClip, cutOnBeats, autoMontage } from './ui/timeline-ui.js';
import { mountInspector } from './ui/inspector.js';
import { mountMaskEditor, maskEdit } from './ui/mask-ui.js';
import { mountMediaBin, importResults } from './ui/media-bin.js';
import { mountMutate } from './ui/mutate-ui.js';
import { mountLiving } from './ui/living-ui.js';
import { mountReactive, runAnalysis } from './ui/reactive-ui.js';
import { mountProjectSettings } from './ui/project-settings.js';
import { openExportDialog, isExporting } from './ui/export-dialog.js';
import { openAutoEdit } from './ui/autoedit-panel.js';
import { openCaptionEditor, applyCaptionEdits } from './ui/caption-editor.js';
import { openMontageDialog } from './ui/montage-panel.js';
import { mountUpdateButton, checkNow } from './ui/updates.js';
import * as smartMontage from './engine/montage.js';
import { renderProject } from './engine/exporter.js';
import { renderStill } from './engine/still.js';
import { startRoots } from './bg-roots.js';
import { mountTooltips } from './ui/tooltip.js';
import * as autoEditEngine from './engine/autoedit.js';
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
    if (side === 'left') { $('app').classList.toggle('wide-left', ['mutate', 'living'].includes(b.dataset.tab)); dispatchEvent(new Event('resize')); } // the variation grid wants room
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
  import: importMedia, export: openExportDialog, autoedit: openAutoEdit, captions: openCaptionEditor, checkUpdates: () => checkNow(),
  undo: () => store.undo(), redo: () => store.redo(), duplicate: duplicateSelected,
  selectAll: () => { if (inTextField()) document.execCommand('selectAll'); else selectAllClips(); },
};
document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.act]()));
hh.onMenu((a) => actions[a]?.());
function selectAllClips() { const ids = store.project.clips.map((c) => c.id); store.multi = new Set(ids); store.selection = ids.at(-1) ?? null; store.emit('selection', 'render'); }

// ---- project name + dirty
const nameIn = $('project-name');
nameIn.addEventListener('input', () => { store.project.name = nameIn.value; store.touch(); });
const monEmpty = $('mon-empty'), monMeta = $('mon-meta');
function syncChrome() {
  if (document.activeElement !== nameIn) nameIn.value = store.project.name;
  $('dirty-dot').hidden = !store.dirty;
  const s = store.project.settings;
  monMeta.textContent = `${s.width} × ${s.height} · ${s.fps} fps`;
  monEmpty.hidden = store.project.clips.length > 0;
  document.documentElement.dataset.empty = String(store.project.clips.length === 0);
  hh.setDirty(store.dirty, store.project.name || 'Untitled');
}
store.on('dirty', syncChrome); store.on('reset', syncChrome); store.on('project', syncChrome);
mountTooltips();
mountUpdateButton();
// bundled faces must be loaded before the canvas draws with them; redraw once they are ready
Promise.all([['400 40px "Pinyon Script"'], ['400 40px "Instrument Serif"'], ['italic 400 40px "Instrument Serif"'], ['500 40px "Inter Tight"'], ['400 40px "DM Mono"'],
  ['400 40px "Michroma"'], ['500 40px "Orbitron"'], ['900 40px "Orbitron"'], ['400 40px "Press Start 2P"'], ['700 40px "UnifrakturCook"'], ['400 40px "Pirata One"'],
  ['400 40px "DotGothic16"', 'サイバー東京'], ['400 40px "Dela Gothic One"', 'FUTURE'], ['400 40px "Zen Antique"', '東京夜行の庭'],
  ...[['Rozha One', 400], ['Yatra One', 400], ['Modak', 400], ['Tiro Devanagari Hindi', 400], ['Eczar', 800], ['Teko', 700], ['Khand', 700], ['Kalam', 700], ['Amita', 700], ['Martel', 900]].map(([f, w]) => [`${w} 40px "${f}"`, 'हिन्दी Hindi']),
  ...[['Rubik Distressed', 400], ['Londrina Solid', 900], ['Reenie Beanie', 400], ['Covered By Your Grace', 400], ['Courier Prime', 700], ['Monoton', 400], ['Shrikhand', 400], ['Righteous', 400], ['Audiowide', 400], ['Space Grotesk', 700], ['Space Mono', 700], ['Syne', 800], ['Unbounded', 900], ['Big Shoulders Display', 900], ['Metal Mania', 400], ['New Rocker', 400], ['Cinzel Decorative', 900], ['Grenze Gotisch', 900], ['IM Fell English SC', 400]].map(([f, w]) => [`${w} 40px "${f}"`, 'HIGH HUMAN']),
  ...[['Inknut Antiqua', 400], ['Inknut Antiqua', 800], ['Tillana', 700], ['Dekko', 400], ['Jaini', 400], ['Sarpanch', 800], ['Gotu', 400], ['Kurale', 400]].map(([f, w]) => [`${w} 40px "${f}"`, 'ध्यान शांति Hindi']),
  ...['Anton', 'Permanent Marker', 'Special Elite', 'Rubik Spray Paint', 'Black Ops One', 'Rubik Glitch', 'Archivo Black', 'Rock Salt', 'Bungee', 'Bebas Neue'].map((f) => [`400 40px "${f}"`, 'HIGH HUMAN'])].map(([f, t]) => document.fonts.load(f, t)))
  .then(() => store.emit('render')).catch(() => {});
$('tl-montage').onclick = openMontageDialog;

// Slow parallax: the root background drifts a few pixels against the pointer (skipped for reduced-motion, cheap: one rAF-throttled style write).
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let raf = 0, px = 0, py = 0;
  addEventListener('pointermove', (e) => {
    px = (e.clientX / innerWidth - 0.5) * 2; py = (e.clientY / innerHeight - 0.5) * 2;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; const st = document.documentElement.style; st.setProperty('--px', px.toFixed(3)); st.setProperty('--py', py.toFixed(3)); });
  }, { passive: true });
}

// ---- mount modules
const preview = mountPreview();
const previewEdit = mountPreviewEdit({ preview });
const maskEditor = mountMaskEditor({ preview });
const timeline = mountTimeline();
mountInspector($('inspector'));
mountMediaBin({ onImport: importResults });
const mutateUi = mountMutate({ preview });
const living = mountLiving({ preview });
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
  if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'x' || e.key === 'X' || e.code === 'KeyX')) { e.preventDefault(); clearRange(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return; // menu accelerators own these
  const fps = store.project.settings.fps;
  switch (e.key) {
    case ' ': e.preventDefault(); preview.toggle(); break;
    case 's': case 'S': splitSelected(); break;
    case 'Delete': case 'Backspace': e.preventDefault(); deleteSelected({ ripple: e.shiftKey }); break;
    case 'ArrowLeft': e.preventDefault(); preview.pause(); store.setPlayhead(store.playhead - (e.shiftKey ? 1 : 1 / fps)); break;
    case 'ArrowRight': e.preventDefault(); preview.pause(); store.setPlayhead(store.playhead + (e.shiftKey ? 1 : 1 / fps)); break;
    case 'Home': store.setPlayhead(0); break;
    case 'i': case 'I': setMark('in'); break;
    case 'o': case 'O': setMark('out'); break;
    case 'Escape': store.select(null); break;
    case '+': case '=': timeline.setZoom(store.zoom * 1.25); break;
    case '-': timeline.setZoom(store.zoom / 1.25); break;
    default: break;
  }
});
addEventListener('error', (e) => toast(`Unexpected error: ${e.message}`, 'error'));
addEventListener('unhandledrejection', (e) => toast(`Unexpected error: ${e.reason?.message || e.reason}`, 'error'));

// Clip copy/paste rides on the native Edit menu's copy/paste events, so text fields keep normal behaviour.
function inTextField() { return ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !['range', 'checkbox'].includes(document.activeElement.type); }
document.addEventListener('copy', (e) => { if (!inTextField() && copySelected()) { e.preventDefault(); toast('Clip copied.'); } });
document.addEventListener('paste', (e) => { if (!inTextField() && store.clipboard) { e.preventDefault(); pasteClip(); } });

// ---- automation hook (used by scripts/e2e.mjs; harmless in normal use)
window.__app = {
  mutateUi, living, reverseSelected, freezeAtPlayhead, placeAdlibs, stutterAtPlayhead, previewEdit, maskEditor, maskEdit, store, preview, timeline, autoEdit: autoEditEngine, captionEdit: { applyCaptionEdits }, smartMontage, autosave: { writeNow, offerRecovery }, runAnalysis, cutOnBeats, autoMontage, importPaths: async (paths) => importResults(await hh.probePaths(paths)),
  exportTo: async (outPath, overrides = {}) => {
    const s = store.project.settings;
    const { range: _r, ...ov } = overrides; const settings = { width: s.width, height: s.height, fps: s.fps, quality: "draft", format: outPath.endsWith(".webm") ? "webm" : "mp4", ...ov, outPath };
    if (JSON.stringify(store.project).includes('"bindings":{"') && (store.analysisStale || !store.analysis)) await runAnalysis({ quiet: true });
    return renderProject({ project: structuredClone(store.project), settings, analysis: store.analysis, onProgress: () => {}, signal: { cancelled: false }, range: overrides.range || null });
  },
};
