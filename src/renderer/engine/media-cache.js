// Lazily builds timeline visuals (video thumbnail sprite, audio peaks) once per media item.
import { store } from '../store.js';

const cache = new Map(); // mediaId -> {thumbs, peaks, started}

export function visualsFor(media) {
  if (!media || media.missing || media.kind === 'image') return null;
  let v = cache.get(media.id);
  if (v && v.path === media.path) return v;
  v = { path: media.path, thumbs: null, peaks: null };
  cache.set(media.id, v);
  const done = () => store.emit('mediavis');
  if (media.kind === 'video') {
    window.hh.mediaThumbs({ path: media.path, duration: media.duration, width: media.width, height: media.height }).then((r) => {
      const img = new Image();
      img.onload = () => { v.thumbs = { img, step: r.step, n: r.n, tileW: r.tileW, h: r.h }; done(); };
      img.src = URL.createObjectURL(new Blob([r.jpeg], { type: 'image/jpeg' }));
    }).catch(() => { /* thumbnails are decorative; keep the plain clip */ });
  }
  if (media.kind === 'audio') {
    window.hh.mediaPeaks(media.path).then((r) => { v.peaks = { data: new Uint8Array(r.peaks), perSec: r.perSec }; done(); }).catch(() => {});
  }
  return v;
}

/** Draws thumbnails or the waveform for the visible part of a clip onto `canvas`. */
export function drawVisuals(canvas, clip, vis, zoom) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const pxPerSec = W / clip.duration;
  ctx.clearRect(0, 0, W, H);
  if (vis.thumbs) {
    const { img, step, n, tileW, h } = vis.thumbs;
    const dw = Math.max(8, Math.round(H * (tileW / h)));
    for (let x = 0; x < W; x += dw) {
      const t = clip.in + (x + dw / 2) / pxPerSec;
      const idx = Math.min(n - 1, Math.max(0, Math.round(t / step - 0.0001)));
      ctx.drawImage(img, idx * tileW, 0, tileW, h, x, 0, dw, H);
    }
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(0, 0, W, H);
  } else if (vis.peaks) {
    const { data, perSec } = vis.peaks;
    ctx.fillStyle = 'rgba(85,185,130,.85)';
    for (let x = 0; x < W; x++) {
      const a = Math.floor((clip.in + x / pxPerSec) * perSec), b = Math.max(a + 1, Math.ceil((clip.in + (x + 1) / pxPerSec) * perSec));
      let m = 0; for (let i = a; i < b && i < data.length; i++) if (data[i] > m) m = data[i];
      const hh = Math.max(1, (m / 255) * H * 0.9);
      ctx.fillRect(x, (H - hh) / 2, 1, hh);
    }
  }
}
