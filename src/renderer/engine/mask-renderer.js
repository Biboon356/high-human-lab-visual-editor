// Draws a mask (shared/mask.js) into a canvas: white where the clip shows, transparent elsewhere. The compositor uploads the
// alpha channel as a texture. Feather is a blur of the finished shape, grow/shrink a stroke added to (or cut from) its edge.
import { maskTransform } from '/shared/mask.js';

function tracePath(ctx, s, W, H) {
  ctx.beginPath();
  if (s.k === 'poly') {
    s.pts.forEach(([u, v], i) => (i ? ctx.lineTo(u * W, v * H) : ctx.moveTo(u * W, v * H)));
    ctx.closePath();
  } else if (s.k === 'ellipse') {
    ctx.ellipse(s.cx * W, s.cy * H, (s.w * W) / 2, (s.h * H) / 2, 0, 0, Math.PI * 2);
  } else {
    const x = (s.cx - s.w / 2) * W, y = (s.cy - s.h / 2) * H, w = s.w * W, h = s.h * H, r = Math.min(w, h) * (s.r || 0);
    if (r > 0.5 && ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
}

/**
 * @param out      destination 2D context (W×H canvas); it is cleared first
 * @param scratch  second canvas of the same size used for the un-blurred shape
 */
export function rasterizeMask(out, scratch, mask, props, W, H) {
  const sc = scratch.getContext('2d');
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.globalCompositeOperation = 'source-over';
  sc.clearRect(0, 0, W, H);
  const xf = maskTransform(mask, props);
  const grow = (props.maskGrow || 0) * 0.1 * H; // px of the *shape* (before scaling)
  sc.save();
  // turn / scale about the middle of the shapes, then slide
  sc.translate((xf.pu + xf.dx) * W, (xf.pv + xf.dy) * H);
  sc.rotate(xf.rot);
  sc.scale(xf.s, xf.s);
  sc.translate(-xf.pu * W, -xf.pv * H);
  sc.fillStyle = sc.strokeStyle = '#fff';
  sc.lineJoin = 'round';
  for (const s of mask.shapes) {
    if (s.sub) continue;
    tracePath(sc, s, W, H);
    sc.fill();
    if (grow > 0.2) { sc.lineWidth = grow * 2; sc.stroke(); }
  }
  if (grow < -0.2) { // shrinking: cut a band along the edge of every added shape
    sc.globalCompositeOperation = 'destination-out';
    sc.lineWidth = -grow * 2;
    for (const s of mask.shapes) if (!s.sub) { tracePath(sc, s, W, H); sc.stroke(); }
  }
  sc.globalCompositeOperation = 'destination-out';
  for (const s of mask.shapes) if (s.sub) { tracePath(sc, s, W, H); sc.fill(); }
  sc.restore();

  const blur = Math.max(0, props.maskFeather || 0) * 0.05 * H * xf.s;
  out.setTransform(1, 0, 0, 1, 0, 0);
  out.globalCompositeOperation = 'source-over';
  out.clearRect(0, 0, W, H);
  out.filter = blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : 'none';
  out.drawImage(scratch, 0, 0);
  out.filter = 'none';
}
