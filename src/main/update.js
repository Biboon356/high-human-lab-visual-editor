// Electron side of in-app updates: checks GitHub for a newer code bundle, stages it quietly, and offers a restart.
// Nothing is ever applied without the user pressing "Restart"; nothing is shown when offline (the failure is only reported on a manual check).
import { app, ipcMain, net, shell } from 'electron';
import { checkLatest, stageUpdate, readState, chooseUpdate, compareVersions, RELEASE_API } from './update-core.js';

const REPO_URL = 'https://github.com/Biboon356/high-human-lab-visual-editor/';

export function mountUpdates({ getWindow }) {
  const boot = globalThis.__hhUpdate;
  const api = process.env.HHLAB_UPDATE_API || RELEASE_API;
  const fetchFn = (url, opts) => net.fetch(url, opts);
  let st = { state: 'idle', checking: false, version: boot?.version || app.getVersion(), installed: boot?.bundledVersion || app.getVersion(), next: null, notes: '', releaseUrl: '', error: null, checkedAt: null };

  const publish = () => { getWindow()?.webContents.send('update:event', { ...st }); return { ...st }; };

  // an update staged by an earlier run that the user has not restarted into yet
  function adoptStaged() {
    if (!boot) return;
    const staged = readState(boot.updatesDir).ready;
    if (staged && compareVersions(staged, boot.version) > 0 && chooseUpdate({ dir: boot.updatesDir, bundledVersion: boot.bundledVersion, shellKey: boot.shellKey })) st = { ...st, state: 'ready', next: staged };
  }

  async function check() {
    if (!boot || st.checking) return { ...st };
    st = { ...st, checking: true, error: null }; publish();
    try {
      const staged = readState(boot.updatesDir).ready;
      const newest = staged && compareVersions(staged, boot.version) > 0 ? staged : boot.version;
      const info = await checkLatest({ fetchFn, api, currentVersion: newest, shellKey: boot.shellKey });
      if (info.status === 'available') {
        await stageUpdate({ fetchFn, info, dir: boot.updatesDir, shellKey: boot.shellKey, keep: [boot.active].filter(Boolean) });
        st = { ...st, state: 'ready', next: info.version, notes: info.notes, releaseUrl: info.releaseUrl };
      } else if (info.status === 'needs-installer') {
        st = { ...st, state: 'needs-installer', next: info.version, notes: info.notes, releaseUrl: info.releaseUrl };
      } else if (st.state !== 'ready') st = { ...st, state: 'uptodate', next: null };
    } catch (e) { st = { ...st, error: e.message }; }
    st = { ...st, checking: false, checkedAt: Date.now() };
    return publish();
  }

  ipcMain.handle('update:status', () => ({ ...st }));
  ipcMain.handle('update:check', () => check());
  ipcMain.handle('update:apply', () => {
    if (st.state !== 'ready') return false;
    app.relaunch();
    app.exit(0);
    return true;
  });
  ipcMain.handle('update:openRelease', () => { if (st.releaseUrl.startsWith(REPO_URL)) shell.openExternal(st.releaseUrl); });

  adoptStaged();
  if (!process.env.HHLAB_NO_UPDATES && (app.isPackaged || process.env.HHLAB_UPDATE_FORCE)) {
    const delay = Number(process.env.HHLAB_UPDATE_DELAY_MS) || 8000;
    setTimeout(check, delay);
    setInterval(check, 6 * 3600 * 1000).unref?.();
  }
  return { check };
}
