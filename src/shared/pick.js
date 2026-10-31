// Picking in the preview: where does a clip sit on the canvas? Pure geometry, so it can be tested without a GPU.
import { findMedia } from './project.js';

/** Axis-aligned box (canvas pixels, y down) that a media clip covers: the source fitted to the canvas, then scaled / moved / rotated by its props. */
export function mediaBox(project, clip, props, W, H) {
  const media = clip.type === 'media' ? findMedia(project, clip.mediaId) : null;
  if (!media || media.kind === 'audio' || !media.width || !media.height) return null;
  const fit = Math.min(W / media.width, H / media.height) * props.scale;
  const hw = (media.width * fit) / 2, hh = (media.height * fit) / 2;
  const cx = W / 2 + props.x * W, cy = H / 2 - props.y * H;         // props.y is "up" like the compositor's
  const a = (props.rotation * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const ex = hw * c + hh * s, ey = hw * s + hh * c;                  // half-extents of the rotated rectangle's bounding box
  return { x0: cx - ex, y0: cy - ey, x1: cx + ex, y1: cy + ey };
}

export const inBox = (b, x, y, pad = 0) => !!b && x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad;
export const boxCenter = (b) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });

/** Tight box around the non-transparent pixels of RGBA data (alpha above `min`), or null if the picture is empty. */
export function alphaBox(data, W, H, min = 10) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    for (let x = 0; x < W; x++) {
      if (data[row + x * 4 + 3] > min) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Snaps a normalised position to the frame centre when it is within `tol` of it. */
export const snapToCentre = (v, tol = 0.012) => (Math.abs(v) < tol ? 0 : v);
