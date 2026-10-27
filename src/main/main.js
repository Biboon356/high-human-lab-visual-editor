import { app, BrowserWindow, Menu, dialog, ipcMain, protocol, net, shell, session as electronSession } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { probeMedia, makeProxy, decodePcm, ExportSession, ClipDecoder, makeThumbs, makePeaks, FFMPEG } from './ffmpeg.js';
import { validateProject } from '../shared/project.js';
import { buildAnalysisArgs, buildExportArgs, validateExportSettings, FORMATS } from '../shared/export-plan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..');
const ROOTS = { app: path.join(SRC, 'renderer'), shared: path.join(SRC, 'shared') };
const allowedMedia = new Set(); // absolute paths the renderer may stream via hhlab://local/media
let win = null;
let dirty = false;
let session = null;
const decoders = new Map();
const closeDecoders = () => { for (const d of decoders.values()) d.close(); decoders.clear(); };

protocol.registerSchemesAsPrivileged([
  { scheme: 'hhlab', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const MEDIA_MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
};

/** Media must answer Range requests with 206 + Content-Range, otherwise Chromium can't seek into files it hasn't buffered. */
function serveMedia(file, request) {
  const size = fs.statSync(file).size;
  const type = MEDIA_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (!m || (m[1] === '' && m[2] === '')) {
    return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...base, 'Content-Length': String(size) } });
  }
  let start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  let end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
    status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
  });
}

function handleProtocol() {
  protocol.handle('hhlab', async (request) => {
    const url = new URL(request.url);
    const [, root, ...rest] = url.pathname.split('/');
    let file;
    if (root === 'media') {
      file = path.resolve(decodeURIComponent(rest.join('/')));
      if (!allowedMedia.has(file)) return new Response('Not an imported media file', { status: 403 });
    } else if (ROOTS[root]) {
      file = path.resolve(ROOTS[root], ...rest.map(decodeURIComponent));
      if (!file.startsWith(ROOTS[root] + path.sep)) return new Response('Forbidden', { status: 403 });
    } else {
      return new Response('Not found', { status: 404 });
    }
    if (!fs.existsSync(file)) return new Response('Not found', { status: 404 });
    if (root === 'media') return serveMedia(file, request);
    return net.fetch(pathToFileURL(file).toString(), { headers: request.headers, bypassCustomProtocolHandlers: true });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0b0d0c',
    ...(fs.existsSync(path.join(SRC, '..', 'build', 'icon.png')) ? { icon: path.join(SRC, '..', 'build', 'icon.png') } : {}),
    title: 'HIGH HUMAN LAB — VISUAL EDITOR',
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.loadURL('hhlab://local/app/index.html');
  win.on('close', (e) => {
    if (!dirty || process.env.HHLAB_E2E) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Cancel', 'Discard changes'], defaultId: 0, cancelId: 0,
      message: 'This project has unsaved changes.', detail: 'Save it first (Cmd/Ctrl+S) or discard the changes.',
    });
    if (choice === 0) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function buildMenu() {
  const send = (a) => () => win?.webContents.send('menu:action', a);
  const mac = process.platform === 'darwin';
  const template = [
    ...(mac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: send('new') },
      { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: send('open') },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
      { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('saveAs') },
      { type: 'separator' },
      { label: 'Import Media…', accelerator: 'CmdOrCtrl+I', click: send('import') },
      { label: 'Export Video…', accelerator: 'CmdOrCtrl+E', click: send('export') },
      { type: 'separator' },
      mac ? { role: 'close' } : { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
      { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: send('redo') },
      { label: 'Duplicate Clip', accelerator: 'CmdOrCtrl+D', click: send('duplicate') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const allow = (p) => allowedMedia.add(path.resolve(p));
const proxyDir = () => path.join(app.getPath('userData'), 'proxies');

async function probeAll(paths) {
  const results = [];
  for (const p of paths) {
    try {
      const info = await probeMedia(p);
      allow(p);
      results.push({ ok: true, info });
    } catch (e) {
      results.push({ ok: false, path: p, error: e.message });
    }
  }
  return results;
}

function registerIpc() {
  ipcMain.handle('media:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Import media', properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return r.canceled ? [] : probeAll(r.filePaths);
  });
  ipcMain.handle('media:probe', (_e, paths) => probeAll(paths));
  const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  ipcMain.handle('media:thumbs', async (_e, o) => {
    if (!allowedMedia.has(path.resolve(o.path))) throw new Error('Not an imported media file');
    const r = await makeThumbs(o.path, o);
    return { jpeg: ab(r.jpeg), step: r.step, n: r.n, tileW: r.tileW, h: r.h };
  });
  ipcMain.handle('media:peaks', async (_e, p) => {
    if (!allowedMedia.has(path.resolve(p))) throw new Error('Not an imported media file');
    const r = await makePeaks(p);
    return { peaks: ab(r.peaks), perSec: r.perSec };
  });
  ipcMain.handle('media:proxy', async (_e, src) => {
    fs.mkdirSync(proxyDir(), { recursive: true });
    const key = crypto.createHash('sha1').update(src + fs.statSync(src).mtimeMs).digest('hex').slice(0, 16);
    const dest = path.join(proxyDir(), `${key}.mp4`);
    if (!fs.existsSync(dest)) await makeProxy(src, dest);
    allow(dest);
    return dest;
  });

  ipcMain.handle('project:open', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Open project', properties: ['openFile'], filters: [{ name: 'HIGH HUMAN LAB project', extensions: ['hhlab'] }] });
    if (r.canceled) return null;
    const file = r.filePaths[0];
    let project;
    try {
      project = validateProject(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      throw new Error(`Could not open ${path.basename(file)}: ${e.message}`);
    }
    const missing = [];
    for (const m of project.media) {
      if (fs.existsSync(m.path)) allow(m.path); else missing.push(m.id);
      if (m.proxyPath && fs.existsSync(m.proxyPath)) allow(m.proxyPath);
    }
    return { project, filePath: file, missing };
  });
  ipcMain.handle('project:save', async (_e, { project, filePath, saveAs }) => {
    let file = filePath;
    if (!file || saveAs) {
      const r = await dialog.showSaveDialog(win, { title: 'Save project', defaultPath: `${project.name || 'Untitled'}.hhlab`, filters: [{ name: 'HIGH HUMAN LAB project', extensions: ['hhlab'] }] });
      if (r.canceled) return null;
      file = r.filePath.endsWith('.hhlab') ? r.filePath : `${r.filePath}.hhlab`;
    }
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(project, null, 2));
    fs.renameSync(tmp, file); // atomic replace: never leaves a half-written project
    return { filePath: file };
  });

  // Crash recovery: the renderer pushes the project here while it has unsaved changes.
  const autosavePath = () => path.join(app.getPath('userData'), 'autosave.hhlab');
  ipcMain.handle('autosave:write', (_e, json) => {
    const tmp = `${autosavePath()}.tmp`;
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, autosavePath());
    return true;
  });
  ipcMain.handle('autosave:read', (_e, opts) => {
    if ((opts?.startup && process.env.HHLAB_E2E_NO_RECOVERY) || !fs.existsSync(autosavePath())) return null;
    try {
      const project = validateProject(JSON.parse(fs.readFileSync(autosavePath(), 'utf8')));
      for (const m of project.media) { if (fs.existsSync(m.path)) allow(m.path); else m.missing = true; if (m.playPath && fs.existsSync(m.playPath)) allow(m.playPath); }
      return { project, savedAt: fs.statSync(autosavePath()).mtimeMs };
    } catch { return null; } // a corrupt autosave must never block startup
  });
  ipcMain.handle('autosave:clear', () => { fs.rmSync(autosavePath(), { force: true }); return true; });
  ipcMain.handle('audio:analyze', async (_e, project) => {
    const args = buildAnalysisArgs(project, 22050);
    if (!args) return null;
    const pcm = await decodePcm(args);
    return { sampleRate: 22050, pcm: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) };
  });

  ipcMain.handle('file:savePng', async (_e, { bytes, name }) => {
    const r = await dialog.showSaveDialog(win, { title: 'Save frame', defaultPath: `${name}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (r.canceled) return null;
    const file = r.filePath.endsWith('.png') ? r.filePath : `${r.filePath}.png`;
    fs.writeFileSync(file, Buffer.from(bytes));
    return file;
  });
  ipcMain.handle('export:pickPath', async (_e, { defaultName, format }) => {
    const f = FORMATS[format] || FORMATS.mp4;
    const r = await dialog.showSaveDialog(win, { title: 'Export video', defaultPath: `${defaultName}.${f.ext}`, filters: [{ name: f.label, extensions: [f.ext] }] });
    return r.canceled ? null : r.filePath;
  });
  ipcMain.handle('export:start', (_e, { project, settings }) => {
    if (session) throw new Error('An export is already running.');
    const errs = validateExportSettings(settings);
    if (errs.length) throw new Error(errs.join(' '));
    for (const m of project.media) if (!fs.existsSync(m.path)) throw new Error(`Source file is missing: ${m.path}`);
    fs.mkdirSync(path.dirname(settings.outPath), { recursive: true });
    const total = Math.round(settings.duration * settings.fps);
    const args = buildExportArgs(project, settings);
    if (process.env.HHLAB_DUMP_ARGS) fs.writeFileSync(process.env.HHLAB_DUMP_ARGS, JSON.stringify(args)); // debugging aid: capture the exact ffmpeg command
    closeDecoders();
    session = new ExportSession(args, settings.outPath, total, (p) => win?.webContents.send('export:progress', { encoded: Math.min(1, p) }));
    return { ffmpeg: FFMPEG };
  });
  // Diagnostics for a stuck/slow export (used by the e2e watchdog and handy in bug reports).
  ipcMain.handle('export:debug', () => ({
    session: session ? { written: session.written, tail: session.tail.slice(-3), failed: session.failed?.message || null } : null,
    decoders: [...decoders].map(([id, d]) => ({ id, queued: d.queue.length, ended: d.ended, waiting: d.waiters.length, got: !!d.last, err: d.error?.message || null })),
  }));
  ipcMain.handle('export:openDecoder', (_e, o) => {
    if (!session) throw new Error('No export session.');
    if (!allowedMedia.has(path.resolve(o.path)) || !fs.existsSync(o.path)) throw new Error(`Source file is missing: ${o.path}`);
    decoders.set(o.id, new ClipDecoder(o));
    return true;
  });
  ipcMain.handle('export:nextFrame', async (_e, id) => {
    const d = decoders.get(id);
    if (!d) throw new Error('Unknown decoder.');
    const f = await d.next();
    return f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength);
  });
  ipcMain.handle('export:frame', async (_e, buf) => {
    if (!session) throw new Error('No export session.');
    await session.writeFrame(Buffer.from(buf));
    return true;
  });
  ipcMain.handle('export:finish', async () => {
    const s = session;
    if (!s) throw new Error('No export session.');
    closeDecoders();
    try {
      await s.finish();
      const stat = fs.statSync(s.outPath);
      if (!stat.size) throw new Error('Encoder finished but the output file is empty.');
      const info = await probeMedia(s.outPath);
      return { path: s.outPath, bytes: stat.size, duration: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio, frames: s.written };
    } catch (e) {
      fs.rmSync(s.outPath, { force: true });
      throw e;
    } finally {
      session = null;
    }
  });
  ipcMain.handle('export:cancel', async () => {
    if (!session) return false;
    const s = session; session = null;
    closeDecoders();
    await s.cancel();
    return true;
  });

  ipcMain.on('app:dirty', (_e, d, title) => {
    dirty = !!d;
    if (win && title) win.setTitle(`${d ? '• ' : ''}${title} — HIGH HUMAN LAB`);
  });
  ipcMain.handle('app:reveal', (_e, p) => shell.showItemInFolder(p));
}

app.whenReady().then(() => {
  // The only permission the app ever needs is listing installed fonts for the Typography Lab.
  electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'local-fonts'));
  electronSession.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'local-fonts');
  handleProtocol();
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
// Never leave encoder/decoder processes running if the app quits (or the window is closed) mid-export.
function killChildren() {
  closeDecoders();
  if (session) { session.proc.kill('SIGKILL'); session = null; }
}
app.on('before-quit', killChildren);
process.on('exit', killChildren);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { killChildren(); process.exit(0); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
