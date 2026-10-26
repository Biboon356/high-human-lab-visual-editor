// Draws a text clip into a 2D canvas the size of the frame. Position/rotation/scale are applied here
// so rotation pivots on the text itself. Animations are pure functions of clip-local time.
const GENERIC = new Set(['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy']);
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const ease = (u) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);

export function fontString(text, px) {
  const fam = GENERIC.has(text.font) ? text.font : `"${text.font}", sans-serif`;
  return `${text.italic ? 'italic ' : ''}${text.weight} ${px}px ${fam}`;
}

export function drawTextClip(ctx, W, H, clip, t, p) {
  const T = clip.text;
  ctx.clearRect(0, 0, W, H);
  const a = T.anim || { type: 'none', duration: 1, speed: 1 };
  const dur = Math.max(0.05, a.duration);
  const u = t / dur;
  let alpha = p.opacity, dx = 0, dy = 0, scale = p.scale;
  let content = T.uppercase ? T.content.toUpperCase() : T.content;

  switch (a.type) {
    case 'typewriter': {
      const total = content.replace(/\n/g, '').length;
      let n = Math.floor(Math.min(1, u) * total);
      content = content.split('\n').map((l) => { const s = l.slice(0, Math.max(0, n)); n -= l.length; return s; }).join('\n');
      break;
    }
    case 'fade': alpha *= Math.min(1, u) * Math.min(1, (clip.duration - t) / dur); break;
    case 'slide': { const e = ease(u); alpha *= e; dy = (1 - e) * 0.06 * H; break; }
    case 'flicker': {
      const k = Math.floor(t * 18 * a.speed);
      alpha *= hash(k) < 0.18 ? 0.15 + 0.5 * hash(k + 9) : 1;
      break;
    }
    case 'jitter': {
      const k = Math.floor(t * 16 * a.speed);
      const on = hash(k + 3) < 0.35;
      if (on) { dx = (hash(k) - 0.5) * 0.06 * W; dy = (hash(k + 1) - 0.5) * 0.02 * H; }
      break;
    }
    case 'pulse': scale *= 1 + 0.08 * Math.sin(t * Math.PI * 2 * a.speed); break;
    default: break;
  }
  if (alpha <= 0.001 || !content) return;

  const px = Math.max(4, T.size * H * scale);
  ctx.save();
  ctx.font = fontString(T, px);
  ctx.letterSpacing = `${p.tracking * px}px`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = Math.min(1, alpha);

  const lines = content.split('\n');
  const lh = T.lineHeight * px;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const blockW = Math.max(...widths, 1);
  const blockH = lines.length * lh;

  let cx = W / 2 + p.x * W + dx;
  if (a.type === 'ticker') {
    const full = ctx.measureText(T.uppercase ? T.content.toUpperCase() : T.content).width;
    const prog = ((t * a.speed) / dur) % 1;
    cx = W + full / 2 - prog * (W + full);
  }
  ctx.translate(cx, H / 2 - p.y * H + dy);
  ctx.rotate((p.rotation * Math.PI) / 180);

  if (T.bg?.enabled) {
    const pad = T.bg.pad * px;
    const bw = a.type === 'ticker' ? W * 1.3 : blockW + pad * 2;
    ctx.fillStyle = T.bg.color;
    ctx.fillRect(-bw / 2, -blockH / 2 - pad * 0.6, bw, blockH + pad * 1.2);
  }
  lines.forEach((l, i) => {
    const y = (i - (lines.length - 1) / 2) * lh;
    const x = T.align === 'left' ? -blockW / 2 : T.align === 'right' ? blockW / 2 - widths[i] : -widths[i] / 2;
    if (T.strokeWidth > 0) {
      ctx.lineWidth = T.strokeWidth * px;
      ctx.strokeStyle = T.strokeColor;
      ctx.strokeText(l, x, y);
    }
    ctx.fillStyle = T.color;
    ctx.fillText(l, x, y);
  });
  ctx.restore();
}
