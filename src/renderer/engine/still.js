// Renders one frame at full project resolution (same compositor as export) and returns it as a PNG blob.
import { Compositor } from './compositor.js';
import { Sources } from './sources.js';
import { sampleFeatures } from '/shared/audio-analysis.js';

export async function renderStill(project, t, analysis) {
  const { width, height } = project.settings;
  const canvas = document.createElement('canvas');
  const comp = new Compositor(canvas, width, height);
  const sources = new Sources({ mediaUrl: (p) => window.hh.mediaUrl(p), audible: false, decoder: 'element' });
  try {
    await sources.seekAll(project, t + 1e-4, project.settings.fps);
    const r = comp.render({ project, t, sources, features: project.reactive?.enabled !== false ? sampleFeatures(analysis, t) : null });
    if (r.missing.length) throw new Error(`No frame available for "${r.missing[0]}" at this time.`);
    const px = comp.readPixels();
    const img = new ImageData(width, height);
    for (let y = 0; y < height; y++) img.data.set(px.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4); // GL rows are bottom-up
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    const out = document.createElement('canvas'); out.width = width; out.height = height;
    out.getContext('2d').putImageData(img, 0, 0);
    return await new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
  } finally {
    sources.dispose();
    comp.dispose();
  }
}
