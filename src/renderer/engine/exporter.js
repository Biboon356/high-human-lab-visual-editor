// Offline renderer: for every output frame, seek all sources, render through the same
// compositor as the preview, read the pixels back and stream them into ffmpeg (main process).
import { Compositor } from './compositor.js';
import { Sources } from './sources.js';
import { sampleFeatures } from '/shared/audio-analysis.js';
import { projectDuration } from '/shared/timeline.js';

export class ExportCancelled extends Error {}

/**
 * @param {{project, settings:{width,height,fps,quality,format,outPath}, analysis, onProgress:(p:{frame,total,fraction,eta})=>void, signal:{cancelled:boolean}}} o
 * @returns {Promise<{path,bytes,duration,width,height,hasAudio,frames}>}
 */
export async function renderProject({ project, settings, analysis, onProgress, signal }) {
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('The timeline is empty — nothing to render.');
  const { fps } = settings;
  const total = Math.max(1, Math.round(duration * fps));
  const canvas = document.createElement('canvas');
  const comp = new Compositor(canvas, settings.width, settings.height);
  const sources = new Sources({ mediaUrl: (p) => window.hh.mediaUrl(p), audible: false, decoder: settings.decoder || 'ffmpeg', maxDim: 2 * Math.max(settings.width, settings.height) });
  const useReactive = project.reactive?.enabled !== false;
  const started = performance.now();
  let started_ = false;
  let pendingFrame = null;
  try {
    await window.hh.exportStart(project, { ...settings, duration });
    started_ = true;
    let pending = Promise.resolve();
    pendingFrame = pending;
    for (let i = 0; i < total; i++) {
      if (signal.cancelled) throw new ExportCancelled('Export cancelled.');
      const t = i / fps;
      globalThis.__exportState = { frame: i, total, t, phase: 'decode' };
      await sources.seekAll(project, t + 1e-4, fps);
      globalThis.__exportState.phase = 'render';
      const r = comp.render({ project, t, sources, features: useReactive ? sampleFeatures(analysis, t) : null });
      if (r.missing.length) throw new Error(`No decoded video frame for "${r.missing[0]}" at ${t.toFixed(2)}s — refusing to export a gap.`);
      const pixels = comp.readPixels();
      globalThis.__exportState.phase = 'write';
      await pending; // at most one frame in flight to the encoder
      pending = window.hh.exportFrame(pixels);
      pending.catch(() => {}); // observed again at the next `await pending`; this only stops a premature unhandled-rejection report
      pendingFrame = pending;
      if (i % 3 === 0 || i === total - 1) {
        const elapsed = (performance.now() - started) / 1000;
        onProgress({ frame: i + 1, total, fraction: (i + 1) / total, eta: (elapsed / (i + 1)) * (total - i - 1) });
      }
    }
    await pending;
    onProgress({ frame: total, total, fraction: 1, eta: 0, finalizing: true });
    const result = await window.hh.exportFinish();
    if (Math.abs(result.duration - duration) > Math.max(0.5, 2 / fps)) {
      throw new Error(`Output duration (${result.duration.toFixed(2)}s) doesn't match the timeline (${duration.toFixed(2)}s); the render is not trustworthy.`);
    }
    return result;
  } catch (e) {
    if (started_) await window.hh.exportCancel().catch(() => {});
    await pendingFrame?.catch(() => {}); // a frame in flight when we abort must not surface as an unhandled rejection
    throw e;
  } finally {
    sources.dispose();
    comp.dispose();
  }
}
