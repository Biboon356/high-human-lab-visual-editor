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
  let perChar = null; // (charIndex) -> {dy, alpha, sc} for animations that move letters individually
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
    case 'slam': { // scale down from 1.7x with overshoot (easeOutBack), quick fade-in, tiny settle shake
      const e = Math.min(1, u);
      const back = 1 + 2.70158 * Math.pow(e - 1, 3) + 1.70158 * Math.pow(e - 1, 2);
      scale *= 1.7 - 0.7 * back;
      alpha *= Math.min(1, e * 6);
      if (e < 1) { const k = Math.floor(t * 60); dx = (hash(k) - 0.5) * 0.012 * W * (1 - e); dy = (hash(k + 5) - 0.5) * 0.012 * H * (1 - e); }
      break;
    }
    case 'stutter': { // rapid on/off + position stutter, then holds
      if (t < dur) { const k = Math.floor(t * 24 * a.speed); alpha *= hash(k + 2) < 0.6 ? 1 : 0; dx = (hash(k) - 0.5) * 0.03 * W; }
      break;
    }
    case 'letters': {
      const spd = Math.max(0.1, a.speed);
      perChar = (idx) => { const e = ease((t - (idx * 0.05) / spd) / Math.max(0.15, dur * 0.3)); return { dy: (1 - e) * 0.06 * H, alpha: e, sc: 1 + (1 - e) * 0.45 }; };
      break;
    }
    case 'wave':
      perChar = (idx) => ({ dy: Math.sin(t * 3 * a.speed + idx * 0.6) * 0.014 * H, alpha: 1, sc: 1 });
      break;
    case 'scramble': { // characters flicker through random glyphs until they lock into place left-to-right
      const GLYPHS = '#@$%&*+=<>?/|0123456789ABCDEFXZ';
      const total = Math.max(1, content.replace(/\n/g, '').length);
      let idx = 0;
      const lock = Math.min(1.15, u * 1.15);
      content = [...content].map((ch) => {
        if (ch === '\n' || ch === ' ') return ch;
        const i = idx++;
        return i / total < lock - hash(i * 5.3) * 0.12 ? ch : GLYPHS[Math.floor(hash(i * 13.1 + Math.floor(t * 24)) * GLYPHS.length)];
      }).join('');
      break;
    }
    case 'strobe': alpha *= Math.floor(t * 12 * a.speed) % 2 === 0 ? 1 : 0.12; break;
    default: break;
  }
  if (alpha <= 0.001 || !content) return;

  let px0 = T.size * H * scale;
  if (T.fit > 0) { // size the text so its widest line spans `fit` of the frame width, whatever the aspect ratio
    ctx.save();
    ctx.font = fontString(T, 100); ctx.letterSpacing = `${p.tracking * 100}px`;
    const full = (T.uppercase ? T.content.toUpperCase() : T.content).split('\n');
    const wmax = Math.max(...full.map((l) => ctx.measureText(l).width), 1);
    ctx.restore();
    px0 = ((T.fit * W) / wmax) * 100 * scale;
  }
  const px = Math.max(4, px0);
  const FX = { split: 0, shadow: 0, glow: 0, gradient: false, grad1: '#fff', grad2: '#888', ...(T.fx || {}) };
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
  const lineX = (i) => (T.align === 'left' ? -blockW / 2 : T.align === 'right' ? blockW / 2 - widths[i] : -widths[i] / 2);
  const lineY = (i) => (i - (lines.length - 1) / 2) * lh;
  const baseIndex = lines.map((_, i) => lines.slice(0, i).reduce((n, l) => n + [...l].length, 0));
  const pass = (paint, ox = 0) => lines.forEach((l, i) => {
    if (!perChar) { paint(l, lineX(i) + ox, lineY(i)); return; }
    const chars = [...l];
    chars.forEach((ch, k) => {
      if (ch === ' ') return;
      const c = perChar(baseIndex[i] + k);
      if (c.alpha <= 0.002) return;
      const gx = lineX(i) + ox + ctx.measureText(chars.slice(0, k).join('')).width, half = ctx.measureText(ch).width / 2;
      ctx.save(); ctx.globalAlpha *= c.alpha; ctx.translate(gx + half, lineY(i) + c.dy); ctx.scale(c.sc, c.sc);
      paint(ch, -half, 0);
      ctx.restore();
    });
  });

  let fill = T.color;
  if (FX.gradient) { // chrome-style vertical gradient with a bright band near the middle
    const g = ctx.createLinearGradient(0, -blockH / 2, 0, blockH / 2);
    g.addColorStop(0, FX.grad1); g.addColorStop(0.48, FX.grad2); g.addColorStop(0.52, FX.grad1); g.addColorStop(1, FX.grad2);
    fill = g;
  }
  // glow (soft, coloured) underneath, then drop shadow for depth
  if (FX.glow > 0) {
    ctx.save(); ctx.shadowColor = T.strokeColor && T.strokeWidth > 0 ? T.strokeColor : '#55b982'; ctx.shadowBlur = px * 0.45 * FX.glow;
    ctx.fillStyle = T.color; pass((l, x, y) => ctx.fillText(l, x, y)); ctx.restore();
  }
  if (FX.split > 0) { // RGB fringe: additive red/cyan copies behind the main fill
    const off = FX.split * px * 0.07;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ff2a3d'; pass((l, x, y) => ctx.fillText(l, x, y), -off);
    ctx.fillStyle = '#00e0ff'; pass((l, x, y) => ctx.fillText(l, x, y), off);
    ctx.restore();
  }
  ctx.save();
  if (FX.shadow > 0) { ctx.shadowColor = `rgba(0,0,0,${0.55 + 0.4 * FX.shadow})`; ctx.shadowBlur = px * 0.14 * FX.shadow; ctx.shadowOffsetY = px * 0.05 * FX.shadow; ctx.shadowOffsetX = px * 0.02 * FX.shadow; }
  const sw = T.hollow ? Math.max(T.strokeWidth || 0, 0.03) : T.strokeWidth || 0;
  pass((l, x, y) => {
    if (T.hollow) { // faint fill first, then a full-strength outline on top
      const fa = T.fillAlpha ?? 0.15;
      if (fa > 0) { ctx.save(); ctx.globalAlpha *= fa; ctx.fillStyle = fill; ctx.fillText(l, x, y); ctx.restore(); }
      ctx.lineWidth = sw * px; ctx.strokeStyle = T.strokeColor || T.color; ctx.strokeText(l, x, y);
      return;
    }
    if (sw > 0) { ctx.lineWidth = sw * px; ctx.strokeStyle = T.strokeColor; ctx.strokeText(l, x, y); }
    ctx.fillStyle = fill;
    ctx.fillText(l, x, y);
  });
  ctx.restore();
  ctx.restore();
}
