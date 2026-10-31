// In-app updates without a new installer: the app's own code (src/**) is shipped as one checksummed bundle on a GitHub release,
// staged under the user's data folder, and used on the next start. No Electron imports: everything here is unit-tested.
//
// Safety rules (each one is covered by a test):
//   * a bundle is only used when its checksum matches what the release manifest promised
//   * it is only used when it was built for the same "shell" (Electron version + native dependencies) as the installed app;
//     otherwise the user is told a new installer is needed
//   * file paths inside a bundle must stay under src/ (no "..", no absolute paths)
//   * an update that did not finish starting is never tried again (the next start falls back to the bundled code)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const RELEASE_API = 'https://api.github.com/repos/Biboon356/high-human-lab-visual-editor/releases/latest';
const MAX_BUNDLE = 64 * 1024 * 1024;

// ---- versions -------------------------------------------------------------------------------------------------
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '').trim());
  return m ? m.slice(1).map(Number) : null;
}
/** -1 / 0 / 1; an unparsable version compares as "older than anything" so it can never win. */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x && !y) return 0;
  if (!x) return -1;
  if (!y) return 1;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** Identifies the native shell an update can run on: same Electron, same node dependencies. */
export function shellKeyOf({ electron, dependencies = {} }) {
  const deps = Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => (a < b ? -1 : 1)));
  return crypto.createHash('sha1').update(JSON.stringify({ electron, deps })).digest('hex').slice(0, 16);
}

// ---- bundle ---------------------------------------------------------------------------------------------------
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile() && e.name !== '.DS_Store') out.push(p);
  }
  return out;
}

/** @returns {{gz:Buffer, sha256:string, manifest:object}} everything under <rootDir>/src as one gzip'd JSON document */
export function packBundle({ rootDir, version, shellKey, notes = '' }) {
  const srcDir = path.join(rootDir, 'src');
  const files = {};
  for (const f of walk(srcDir).sort()) files[`src/${path.relative(srcDir, f).split(path.sep).join('/')}`] = fs.readFileSync(f).toString('base64');
  const manifest = { version, shellKey, notes, files: Object.keys(files).length };
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ manifest, files })), { level: 9 });
  return { gz, sha256: sha256(gz), manifest };
}

export function validRelPath(rel) {
  return typeof rel === 'string' && rel.startsWith('src/') && !rel.includes('\0') && !rel.includes('\\') && !path.posix.isAbsolute(rel)
    && path.posix.normalize(rel) === rel && !rel.split('/').includes('..');
}

/** Writes a bundle into `destDir` (which must be new). Throws on anything suspicious. Returns the manifest. */
export function unpackBundle(gz, destDir, { maxBytes = MAX_BUNDLE } = {}) {
  let doc;
  try { doc = JSON.parse(zlib.gunzipSync(gz, { maxOutputLength: maxBytes }).toString('utf8')); }
  catch (e) { throw new Error(`The update file is damaged or too large (${e.code || e.message}).`); }
  const mf = doc?.manifest, files = doc?.files;
  if (!mf || parseVersion(mf.version) === null || typeof mf.shellKey !== 'string' || !files || typeof files !== 'object') throw new Error('The update file has no valid manifest.');
  for (const rel of Object.keys(files)) if (!validRelPath(rel)) throw new Error(`The update contains an unsafe path: ${rel}`);
  for (const need of ['src/main/main.js', 'src/renderer/index.html', 'src/renderer/app.js']) if (!(need in files)) throw new Error(`The update is incomplete (missing ${need}).`);
  const root = path.resolve(destDir);
  for (const [rel, b64] of Object.entries(files)) {
    const dest = path.resolve(root, rel);
    if (!dest.startsWith(root + path.sep)) throw new Error(`The update contains an unsafe path: ${rel}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(String(b64), 'base64'));
  }
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(mf));
  // without this Node treats the staged .js files as CommonJS and refuses their `import` statements
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'hhlab-update', private: true, type: 'module' }));
  return mf;
}

// ---- state: which update is staged, and did the last one start? ------------------------------------------------
const stateFile = (dir) => path.join(dir, 'state.json');

export function readState(dir) {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(dir), 'utf8'));
    return { ready: s.ready || null, pending: s.pending || null, verified: s.verified || null, bad: Array.isArray(s.bad) ? s.bad : [] };
  } catch { return { ready: null, pending: null, verified: null, bad: [] }; }
}
export function writeState(dir, st) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${stateFile(dir)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(st));
  fs.renameSync(tmp, stateFile(dir)); // atomic: never a half-written state
}

/** The staged update to run, or null (nothing staged, not newer than the installed app, known-bad, wrong shell, files missing). */
export function chooseUpdate({ dir, bundledVersion, shellKey }) {
  const st = readState(dir), v = st.ready;
  if (!v || st.bad.includes(v) || compareVersions(v, bundledVersion) <= 0) return null;
  const root = path.join(dir, v);
  let mf;
  try { mf = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')); } catch { return null; }
  if (mf.version !== v || mf.shellKey !== shellKey || !fs.existsSync(path.join(root, 'src/main/main.js'))) return null;
  return { version: v, root, manifest: mf };
}

/** If the previous launch of an update never confirmed it started, that update is marked bad. Returns its version or null. */
export function reconcileCrash(dir) {
  const st = readState(dir);
  if (!st.pending) return null;
  const v = st.pending;
  writeState(dir, { ...st, pending: null, bad: [...new Set([...st.bad, v])], ready: st.ready === v ? null : st.ready });
  return v;
}
export function beginLaunch(dir, version) { writeState(dir, { ...readState(dir), pending: version }); }
export function markVerified(dir, version) { writeState(dir, { ...readState(dir), pending: null, verified: version }); }
export function markBad(dir, version) {
  const st = readState(dir);
  writeState(dir, { ...st, pending: null, bad: [...new Set([...st.bad, version])], ready: st.ready === version ? null : st.ready });
}

// ---- talking to GitHub -------------------------------------------------------------------------------------------
async function getJson(fetchFn, url) {
  const r = await fetchFn(url, { headers: { Accept: 'application/vnd.github+json, application/json', 'User-Agent': 'high-human-lab-updater' } });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return r.json();
}

/**
 * Looks at the latest release.
 * @returns {Promise<{status:'none'}|{status:'needs-installer',version:string,notes:string,releaseUrl:string}|{status:'available',version:string,notes:string,url:string,sha256:string,releaseUrl:string}>}
 */
export async function checkLatest({ fetchFn, api = RELEASE_API, currentVersion, shellKey }) {
  const rel = await getJson(fetchFn, api);
  const manifestAsset = (rel.assets || []).find((a) => a.name === 'update.json');
  if (!manifestAsset) return { status: 'none' };
  const u = await getJson(fetchFn, manifestAsset.browser_download_url);
  if (parseVersion(u.version) === null || compareVersions(u.version, currentVersion) <= 0) return { status: 'none' };
  const base = { version: u.version, notes: String(u.notes || ''), releaseUrl: rel.html_url || '' };
  if (u.shellKey !== shellKey) return { status: 'needs-installer', ...base };
  const file = (rel.assets || []).find((a) => a.name === u.file);
  if (!file || !/^[0-9a-f]{64}$/.test(String(u.sha256))) return { status: 'none' };
  return { status: 'available', ...base, url: file.browser_download_url, sha256: u.sha256 };
}

/** Downloads, verifies and unpacks an available update, then marks it as the one to run next. */
export async function stageUpdate({ fetchFn, info, dir, shellKey, keep = [], maxBytes = MAX_BUNDLE }) {
  const r = await fetchFn(info.url, { headers: { 'User-Agent': 'high-human-lab-updater' } });
  if (!r.ok) throw new Error(`The update download answered ${r.status}.`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('The update file is larger than expected; ignoring it.');
  if (sha256(buf) !== info.sha256) throw new Error('The update file does not match its checksum; ignoring it.');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${info.version}.tmp`), dest = path.join(dir, info.version);
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    const mf = unpackBundle(buf, tmp, { maxBytes });
    if (mf.version !== info.version || mf.shellKey !== shellKey) throw new Error('The update was built for a different version of the app shell; a new installer is needed.');
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const st = readState(dir);
  writeState(dir, { ...st, ready: info.version, bad: st.bad.filter((v) => v !== info.version) });
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && e.name !== info.version && !keep.includes(e.name)) fs.rmSync(path.join(dir, e.name), { recursive: true, force: true });
  return { version: info.version };
}
