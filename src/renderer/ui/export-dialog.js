import { el, toast } from './dom.js';
import { store } from '../store.js';
import { RESOLUTIONS } from '/shared/project.js';
import { QUALITY, FORMATS } from '/shared/export-plan.js';
import { projectDuration } from '/shared/timeline.js';
import { renderProject, ExportCancelled } from '../engine/exporter.js';
import { runAnalysis } from './reactive-ui.js';

let busy = false;
export const isExporting = () => busy;

export function openExportDialog({ preset } = {}) {
  if (busy) return;
  if (projectDuration(store.project) <= 0) { toast('Nothing to export yet — add clips to the timeline.', 'error'); return; }
  const s = store.project.settings;
  const root = document.getElementById('modal-root');
  const resOpts = { project: { width: s.width, height: s.height }, ...RESOLUTIONS };
  const sel = (opts, cur) => el('select', {}, Object.entries(opts).map(([k, v]) => el('option', { value: k, text: typeof v === 'string' ? v : v.width ? `${k === 'project' ? 'Project' : k} (${v.width}×${v.height})` : k, ...(k === cur ? { selected: true } : {}) })));
  const res = sel(resOpts, 'project');
  const fps = el('select', {}, [24, 25, 30, 50, 60].map((f) => el('option', { value: f, text: `${f} fps`, ...(f === s.fps ? { selected: true } : {}) })));
  if (![24, 25, 30, 50, 60].includes(s.fps)) fps.prepend(el('option', { value: s.fps, text: `${s.fps} fps`, selected: true }));
  const quality = el('select', {}, Object.keys(QUALITY).map((q) => el('option', { value: q, text: q, ...(q === 'standard' ? { selected: true } : {}) })));
  const format = sel(Object.fromEntries(Object.entries(FORMATS).map(([k, v]) => [k, v.label])), 'mp4');
  const PLATFORMS = {
    custom: { label: 'Custom' },
    tiktok: { label: 'TikTok / Reels / Shorts — 1080×1920 (9:16)', res: 'vertical-1080', fps: 30, quality: 'high', format: 'mp4' },
    youtube: { label: 'YouTube — 1080p', res: '1080p', fps: 30, quality: 'high', format: 'mp4' },
    feed: { label: 'Instagram feed — 1080×1350 (4:5)', res: 'portrait-4x5', fps: 30, quality: 'high', format: 'mp4' },
  };
  const platform = el('select', {}, Object.entries(PLATFORMS).map(([k, v]) => el('option', { value: k, text: v.label })));
  platform.addEventListener('change', () => { const p = PLATFORMS[platform.value]; if (!p.res) return; res.value = p.res; fps.value = p.fps; if (![...fps.options].some((o) => o.value === String(p.fps))) fps.prepend(el('option', { value: p.fps, text: `${p.fps} fps` })); fps.value = p.fps; quality.value = p.quality; format.value = p.format; });
  const pathIn = el('input', { type: 'text', readonly: true, placeholder: 'Choose output file…' });
  const pick = el('button', { text: 'Choose…', onclick: async () => {
    const p = await window.hh.pickExportPath(store.project.name || 'export', format.value);
    if (p) pathIn.value = p;
  } });
  const status = el('div');
  const bar = el('div', { class: 'progress' }, el('b'));
  bar.hidden = true;
  const start = el('button', { class: 'primary', text: 'Render' });
  const close = el('button', { text: 'Close', onclick: () => { if (!busy) root.replaceChildren(); } });
  const cancel = el('button', { text: 'Cancel render' });
  cancel.hidden = true;

  const modal = el('div', { class: 'modal-back' }, el('div', { class: 'modal' },
    el('h3', { text: 'EXPORT VIDEO' }),
    el('div', { class: 'grid' }, 'Preset', platform, 'Resolution', res, 'Frame rate', fps, 'Quality', quality, 'Format', format, 'Output', el('div', { style: 'display:flex;gap:6px' }, pathIn, pick)),
    el('div', { class: 'hint', text: `Duration ${projectDuration(store.project).toFixed(2)}s. Frames are rendered offline with the same engine as the preview, then encoded by ffmpeg.` }),
    bar, status, el('div', { class: 'actions' }, cancel, close, start)));
  root.replaceChildren(modal);
  if (preset && PLATFORMS[preset]) { platform.value = preset; platform.dispatchEvent(new Event('change')); }

  const signal = { cancelled: false };
  cancel.onclick = () => { signal.cancelled = true; status.textContent = 'Cancelling…'; };

  start.onclick = async () => {
    if (!pathIn.value) { status.replaceChildren(el('div', { class: 'errbox', text: 'Choose an output file first.' })); return; }
    const r = resOpts[res.value];
    const settings = { width: r.width, height: r.height, fps: Number(fps.value), quality: quality.value, format: format.value, outPath: pathIn.value };
    busy = true; signal.cancelled = false;
    for (const n of [res, fps, quality, format, pick, start, close]) n.disabled = true;
    cancel.hidden = false; bar.hidden = false; bar.firstChild.style.width = '0%';
    status.replaceChildren(el('div', { class: 'hint', text: 'Preparing…' }));
    try {
      const needsAudioData = JSON.stringify(store.project).includes('"bindings":{"');
      if (needsAudioData && (store.analysisStale || !store.analysis)) { status.textContent = 'Analyzing audio for reactive parameters…'; await runAnalysis({ quiet: true }); }
      const result = await renderProject({
        project: structuredClone(store.project), settings, analysis: store.analysis, signal,
        onProgress: (p) => {
          bar.firstChild.style.width = `${(p.fraction * 100).toFixed(1)}%`;
          status.textContent = p.finalizing ? 'Finalizing file…' : `Frame ${p.frame}/${p.total} · ${(p.fraction * 100).toFixed(0)}% · ~${Math.ceil(p.eta)}s left`;
        },
      });
      status.replaceChildren(el('div', { class: 'okbox' },
        `✔ Render verified\n${result.path}\n${(result.bytes / 1048576).toFixed(2)} MB · ${result.width}×${result.height} · ${result.duration.toFixed(2)}s · ${result.frames} frames · audio: ${result.hasAudio ? 'yes' : 'none'}`),
        el('button', { text: 'Show in folder', onclick: () => window.hh.revealFile(result.path) }));
      status.firstChild.style.whiteSpace = 'pre-wrap';
    } catch (e) {
      bar.hidden = true;
      status.replaceChildren(el('div', { class: e instanceof ExportCancelled ? 'hint' : 'errbox', text: e instanceof ExportCancelled ? 'Export cancelled. No file was written.' : `Export failed: ${e.message}` }));
    } finally {
      busy = false; cancel.hidden = true;
      for (const n of [res, fps, quality, format, pick, start, close]) n.disabled = false;
    }
  };
}
