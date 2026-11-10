// Subtle animated background: slow, branching root-like strokes drawn behind the panels.
// Cheap by design (a few hundred segments, ~15fps, paused when hidden or while playing).
export function startRoots(canvas, isBusy) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, tips = [], age = 0;
  const resize = () => { w = canvas.width = innerWidth + 48; h = canvas.height = innerHeight + 48; reset(); };
  const reset = () => {
    ctx.clearRect(0, 0, w, h);
    age = 0;
    tips = Array.from({ length: 4 }, () => ({ x: Math.random() * w, y: h + 5, a: -Math.PI / 2 + (Math.random() - 0.5) * 0.8, life: 220 + Math.random() * 160, wd: 1.6 }));
  };
  addEventListener('resize', resize);
  resize();
  let last = 0;
  const step = (now) => {
    requestAnimationFrame(step);
    if (document.hidden || isBusy() || now - last < 66) return;
    last = now;
    const color = getComputedStyle(document.documentElement).getPropertyValue('--root-ink').trim() || '#93b57f';
    ctx.strokeStyle = color;
    const next = [];
    for (const t of tips) {
      const nx = t.x + Math.cos(t.a) * 2.2, ny = t.y + Math.sin(t.a) * 2.2;
      ctx.globalAlpha = 0.16;
      ctx.lineWidth = t.wd;
      ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(nx, ny); ctx.stroke();
      t.x = nx; t.y = ny; t.a += (Math.random() - 0.5) * 0.28; t.life--; t.wd = Math.max(0.4, t.wd * 0.998);
      if (t.life > 0 && next.length < 90) next.push(t);
      if (Math.random() < 0.012 && next.length < 90) next.push({ ...t, a: t.a + (Math.random() - 0.5) * 1.4, life: t.life * 0.7, wd: t.wd * 0.7 });
    }
    tips = next;
    age++;
    if (!tips.length || age > 2400) {
      // fade out and restart
      ctx.globalAlpha = 0.08; ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      ctx.fillRect(0, 0, w, h);
      if (age > 2600 || !tips.length) reset();
    }
  };
  requestAnimationFrame(step);
}
