// The real entry point (package.json "main"). Starts either the code that shipped inside the installer or, when one is staged and
// verified, a newer copy of src/ from the user's data folder (see update-core.js). If anything about the newer copy is wrong the
// installer's own code runs instead, so an update can never leave the app unable to start.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { shellKeyOf, chooseUpdate, reconcileCrash, beginLaunch, markVerified, markBad } from './update-core.js';

const appRoot = app.getAppPath();
globalThis.__hhAppRoot = appRoot;
const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const updatesDir = process.env.HHLAB_UPDATES_DIR || path.join(app.getPath('userData'), 'updates');
const shellKey = shellKeyOf({ electron: process.versions.electron, dependencies: pkg.dependencies });
const bundled = new URL('./main.js', import.meta.url).href;

let active = null;
try {
  if (!process.env.HHLAB_NO_UPDATES) {
    const crashed = reconcileCrash(updatesDir);
    if (crashed) console.error(`[update] ${crashed} did not finish starting last time; using the installed version instead.`);
    active = chooseUpdate({ dir: updatesDir, bundledVersion: pkg.version, shellKey });
    if (active) beginLaunch(updatesDir, active.version);
  }
} catch (e) { console.error('[update] could not read update state:', e.message); active = null; }

globalThis.__hhUpdate = {
  bundledVersion: pkg.version, version: active?.version || pkg.version, active: active?.version || null, shellKey, updatesDir,
  /** main.js calls this once the window has loaded: only then is an update considered good. */
  markGood() { if (active) { try { markVerified(updatesDir, active.version); } catch { /* read-only profile */ } } },
};

try {
  await import(active ? pathToFileURL(path.join(active.root, 'src/main/main.js')).href : bundled);
} catch (e) {
  if (!active) throw e;
  // The update's code may already have registered handlers before it threw, so running the installed code in this same process could
  // end up with two apps. Blacklist the update and restart cleanly instead; the next start uses the installed code.
  console.error(`[update] ${active.version} failed to load (${e.message}); restarting with the installed version.`);
  try { markBad(updatesDir, active.version); } catch { /* ignore */ }
  app.relaunch();
  app.exit(0);
}
