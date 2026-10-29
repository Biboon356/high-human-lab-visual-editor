// Draws a shape clip (shared/shape-defs.js) into the frame-sized 2D canvas, centred on its position, like a title.
import { normalizeShape, shapeBox } from '/shared/shape-defs.js';

const TAU = Math.PI * 2;

function paint(ctx, s, hh, fillStyle) {
  if (s.fill) { ctx.fillStyle = fillStyle; ctx.fill(); }
  if (s.stroke > 0) { ctx.strokeStyle = s.strokeColor || s.color; ctx.lineWidth = Math.max(1, s.stroke * ctx.canvas.height); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
}

function leaf(ctx, len, wid) { // a pointed petal standing on the origin, pointing up
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(wid, -len * 0.25, wid * 0.8, -len * 0.75, 0, -len);
  ctx.bezierCurveTo(-wid * 0.8, -len * 0.75, -wid, -len * 0.25, 0, 0);
}

const PATHS = {
  rect(ctx, s, hw, hh) { const r = Math.min(hw, hh) * Math.min(1, Math.max(0, s.ratio ?? 0)); ctx.beginPath(); if (r > 0.5 && ctx.roundRect) ctx.roundRect(-hw, -hh, hw * 2, hh * 2, r); else ctx.rect(-hw, -hh, hw * 2, hh * 2); },
  ellipse(ctx, s, hw, hh) { ctx.beginPath(); ctx.ellipse(0, 0, hw, hh, 0, 0, TAU); },
  diamond(ctx, s, hw, hh) { ctx.beginPath(); ctx.moveTo(0, -hh); ctx.lineTo(hw, 0); ctx.lineTo(0, hh); ctx.lineTo(-hw, 0); ctx.closePath(); },
  star(ctx, s, hw, hh) {
    ctx.beginPath();
    for (let i = 0; i < s.n * 2; i++) { const a = (i / (s.n * 2)) * TAU - Math.PI / 2, k = i % 2 ? s.ratio : 1; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * hw * k, Math.sin(a) * hh * k); }
    ctx.closePath();
  },
  arch(ctx, s, hw, hh) { // pointed arch: straight sides, two curves meeting at the apex
    ctx.beginPath(); ctx.moveTo(-hw, hh); ctx.lineTo(-hw, -hh + hw * (1.1 + s.ratio * 0.4));
    ctx.quadraticCurveTo(-hw, -hh + hw * 0.3, 0, -hh); ctx.quadraticCurveTo(hw, -hh + hw * 0.3, hw, -hh + hw * (1.1 + s.ratio * 0.4)); ctx.lineTo(hw, hh); ctx.closePath();
  },
  flame(ctx, s, hw, hh) {
    ctx.beginPath(); ctx.moveTo(0, -hh);
    ctx.bezierCurveTo(hw * 0.25, -hh * 0.45, hw, -hh * 0.1, hw, hh * 0.4);
    ctx.bezierCurveTo(hw, hh * 0.85, hw * 0.5, hh, 0, hh);
    ctx.bezierCurveTo(-hw * 0.5, hh, -hw, hh * 0.85, -hw, hh * 0.4);
    ctx.bezierCurveTo(-hw, -hh * 0.1, -hw * 0.25, -hh * 0.45, 0, -hh); ctx.closePath();
  },
};

export function drawShapeClip(ctx, W, H, clip, t, p) {
  ctx.clearRect(0, 0, W, H);
  const s = normalizeShape(clip.shape);
  const { hw, hh } = shapeBox(s, W, H);
  const alpha = p.opacity;
  if (alpha <= 0.001 || hw < 0.5 || hh < 0.5) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.translate(W / 2 + p.x * W, H / 2 - p.y * H);
  ctx.rotate(((p.rotation + (s.spin || 0) * t) * Math.PI) / 180);
  ctx.scale(p.scale, p.scale);
  let fillStyle = s.color;
  if (s.gradient && s.color2) { const g = ctx.createLinearGradient(0, -hh, 0, hh); g.addColorStop(0, s.color); g.addColorStop(1, s.color2); fillStyle = g; }
  if (s.shadow > 0) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = hh * 0.35 * s.shadow + 2; ctx.shadowOffsetY = hh * 0.08 * s.shadow; }
  if (s.glow > 0) { ctx.shadowColor = s.strokeColor || s.color; ctx.shadowBlur = Math.max(hw, hh) * 0.5 * s.glow; ctx.shadowOffsetY = 0; }

  switch (s.kind) {
    case 'rect': case 'ellipse': case 'diamond': case 'star': case 'arch': PATHS[s.kind](ctx, s, hw, hh); paint(ctx, s, hh, fillStyle); break;
    case 'flame': {
      PATHS.flame(ctx, s, hw, hh); paint(ctx, s, hh, fillStyle);
      ctx.shadowColor = 'transparent';
      if (s.color2) { ctx.save(); ctx.translate(0, hh * 0.25); ctx.scale(0.5, 0.58); PATHS.flame(ctx, s, hw, hh); ctx.fillStyle = s.color2; ctx.fill(); ctx.restore(); }
      break;
    }
    case 'divider': { // line — gap — diamond — gap — line, with a dot at each end
      const th = Math.max(1, s.stroke * H), gap = hh * 1.6;
      ctx.fillStyle = s.color; ctx.strokeStyle = s.color;
      ctx.fillRect(-hw, -th / 2, hw - gap, th); ctx.fillRect(gap, -th / 2, hw - gap, th);
      ctx.beginPath(); ctx.moveTo(0, -hh); ctx.lineTo(hh, 0); ctx.lineTo(0, hh); ctx.lineTo(-hh, 0); ctx.closePath(); ctx.fill();
      for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(sx * (gap + hh * 0.5), 0, hh * 0.28, 0, TAU); ctx.fill(); }
      break;
    }
    case 'frame': { // outer border with notched corners, inner hairline
      const notch = Math.min(hw, hh) * 0.06, inset = Math.min(hw, hh) * 0.06 * (0.5 + s.ratio);
      const rect = (a, b, n) => { ctx.beginPath(); ctx.moveTo(-a + n, -b); ctx.lineTo(a - n, -b); ctx.lineTo(a, -b + n); ctx.lineTo(a, b - n); ctx.lineTo(a - n, b); ctx.lineTo(-a + n, b); ctx.lineTo(-a, b - n); ctx.lineTo(-a, -b + n); ctx.closePath(); };
      ctx.strokeStyle = s.strokeColor || s.color; ctx.lineWidth = Math.max(1, s.stroke * H);
      rect(hw, hh, notch); ctx.stroke();
      ctx.lineWidth = Math.max(1, s.stroke * H * 0.45); rect(hw - inset, hh - inset, notch * 0.6); ctx.stroke();
      break;
    }
    case 'sun': {
      const R = Math.min(hw, hh), r0 = R * s.ratio;
      ctx.beginPath();
      for (let i = 0; i < s.n; i++) { const a = (i / s.n) * TAU, w = (TAU / s.n) * 0.28; ctx.moveTo(Math.cos(a - w) * r0 * 1.12, Math.sin(a - w) * r0 * 1.12); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); ctx.lineTo(Math.cos(a + w) * r0 * 1.12, Math.sin(a + w) * r0 * 1.12); ctx.closePath(); }
      ctx.arc(0, 0, r0, 0, TAU);
      paint(ctx, s, hh, fillStyle);
      break;
    }
    case 'retrosun': { // a disc cut by slits that thicken towards the bottom
      const R = Math.min(hw, hh);
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fillStyle = fillStyle; ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < s.n; i++) { const u = (i + 1) / (s.n + 1), y = R * (0.05 + u * 0.95), h = R * 0.02 + u * R * 0.075; ctx.fillRect(-R, y, R * 2, h); }
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'lotus': { // three rows of pointed petals fanning out from the base
      const R = Math.min(hw, hh) * 2, rows = 3;
      ctx.translate(0, R * 0.34);
      for (let row = rows - 1; row >= 0; row--) {
        const n = Math.max(3, s.n - row * 2), spread = (0.62 - row * 0.1) * Math.PI, len = R * (0.62 - row * 0.1), wid = R * 0.1 * (1 + s.ratio * 0.3);
        for (let i = 0; i < n; i++) {
          const a = n === 1 ? 0 : -spread + (i / (n - 1)) * spread * 2;
          ctx.save(); ctx.rotate(a); ctx.beginPath(); leaf(ctx, len, wid);
          const g = ctx.createLinearGradient(0, 0, 0, -len); g.addColorStop(0, s.color2 || s.color); g.addColorStop(1, s.color);
          ctx.globalAlpha *= 0.55 + 0.45 * (1 - row / rows); ctx.fillStyle = g; ctx.fill();
          ctx.lineWidth = Math.max(1, R * 0.006); ctx.strokeStyle = s.strokeColor || s.color; ctx.globalAlpha = Math.min(1, alpha) * 0.7; ctx.stroke();
          ctx.restore();
        }
      }
      break;
    }
    case 'rosette': { // a ring of overlapping circles
      const R = Math.min(hw, hh), r = R * 0.5;
      ctx.beginPath();
      for (let i = 0; i < s.n; i++) { const a = (i / s.n) * TAU; ctx.moveTo(Math.cos(a) * r + r, Math.sin(a) * r); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, r, 0, TAU); }
      if (s.fill) { ctx.globalAlpha *= 0.18; ctx.fillStyle = s.color; ctx.fill(); ctx.globalAlpha = Math.min(1, alpha); }
      ctx.strokeStyle = s.strokeColor || s.color; ctx.lineWidth = Math.max(1, (s.stroke || 0.003) * H); ctx.stroke();
      break;
    }
    case 'dotrow': {
      ctx.fillStyle = s.color;
      for (let i = 0; i < s.n; i++) { const x = s.n === 1 ? 0 : -hw + (i / (s.n - 1)) * hw * 2, mid = 1 - Math.abs(i - (s.n - 1) / 2) / ((s.n - 1) / 2 || 1); ctx.beginPath(); ctx.arc(x, 0, hh * (0.55 + 0.45 * mid), 0, TAU); ctx.fill(); }
      break;
    }
    case 'stripes': {
      ctx.beginPath(); ctx.rect(-hw, -hh, hw * 2, hh * 2); ctx.fillStyle = s.color2 || '#111'; ctx.fill(); ctx.clip();
      ctx.fillStyle = s.color; const step = (hw * 2) / s.n;
      for (let x = -hw - hh * 2; x < hw + hh * 2; x += step * 2) { ctx.beginPath(); ctx.moveTo(x, hh); ctx.lineTo(x + step, hh); ctx.lineTo(x + step + hh * 2, -hh); ctx.lineTo(x + hh * 2, -hh); ctx.closePath(); ctx.fill(); }
      break;
    }
    case 'tape': { // translucent strip with torn zig-zag ends
      const z = hh * 0.35;
      ctx.beginPath(); ctx.moveTo(-hw, -hh);
      ctx.lineTo(hw, -hh); for (let i = 0; i <= 6; i++) ctx.lineTo(hw - (i % 2 ? 0 : z), -hh + (i / 6) * hh * 2);
      ctx.lineTo(-hw, hh); for (let i = 6; i >= 0; i--) ctx.lineTo(-hw + (i % 2 ? 0 : z), -hh + (i / 6) * hh * 2);
      ctx.closePath(); ctx.fillStyle = s.color; ctx.fill();
      break;
    }
    default: break;
  }
  ctx.restore();
}
