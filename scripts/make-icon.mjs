// Renders build/icon.png (1024x1024) with the app's own root generator: white roots + green glow on near-black, rounded square.
// Usage: xvfb-run -a node scripts/make-icon.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pw;
for (const name of ['playwright-core', 'playwright']) for (const base of [root + '/', '/opt/node-tools/']) { try { pw = createRequire(base)(name); break; } catch { /* next */ } if (pw) break; }
const app = await pw._electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [root, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], env: { ...process.env, HHLAB_E2E: '1', HHLAB_E2E_NO_RECOVERY: '1' } });
const page = await app.firstWindow();
await page.waitForFunction(() => window.__app);
const dataUrl = await page.evaluate(async () => {
  const { drawRoots } = await import('/app/engine/roots-renderer.js');
  const N = 1024, c = document.createElement('canvas'); c.width = N; c.height = N; const ctx = c.getContext('2d');
  const r = N * 0.2237; // macOS-style squircle-ish radius
  ctx.beginPath(); ctx.roundRect(0, 0, N, N, r); ctx.clip();
  const g = ctx.createRadialGradient(N / 2, N * 0.15, 10, N / 2, N / 2, N * 0.8); g.addColorStop(0, '#0f2a1c'); g.addColorStop(1, '#050706');
  ctx.fillStyle = g; ctx.fillRect(0, 0, N, N);
  const layer = document.createElement('canvas'); layer.width = N; layer.height = N;
  drawRoots(layer.getContext('2d'), N, N, true, { density: 0.9, movement: 0, distortion: 0.55, thickness: 0.55, glow: 0.9, green: 0.55, seed: 11, growth: 1, boil: 0, origin: 0 }, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.strokeStyle = 'rgba(85,185,130,.35)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.roundRect(3, 3, N - 6, N - 6, r); ctx.stroke();
  return c.toDataURL('image/png');
});
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build/icon.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
await app.close();
console.log('wrote build/icon.png');
