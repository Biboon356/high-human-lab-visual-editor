import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import zlib from 'node:zlib'; import crypto from 'node:crypto';
import { compareVersions, parseVersion, shellKeyOf, packBundle, unpackBundle, validRelPath, readState, chooseUpdate, reconcileCrash, beginLaunch, markVerified, markBad, checkLatest, stageUpdate } from '../src/main/update-core.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-upd-'));
const KEY = shellKeyOf({ electron: '33.4.11', dependencies: { b: '^1', a: '^2' } });
function fakeApp(version = '0.2.1') {
  const root = tmp();
  for (const [f, c] of Object.entries({ 'src/main/main.js': `// ${version}`, 'src/main/boot.js': 'x', 'src/renderer/index.html': '<html>', 'src/renderer/app.js': 'a', 'src/renderer/fonts/f.woff2': Buffer.from([0, 255, 7, 1]) })) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), c);
  }
  return root;
}
const rawBundle = (files, mf = { version: '0.3.0', shellKey: KEY }) => zlib.gzipSync(Buffer.from(JSON.stringify({ manifest: mf, files })));
const OK = { 'src/main/main.js': '', 'src/renderer/index.html': '', 'src/renderer/app.js': '' };

test('versions: numeric compare, v-prefix, junk never wins', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1); assert.equal(compareVersions('v1.0.0', '1.0.0'), 0); assert.equal(compareVersions('0.2.0', '0.2.1'), -1);
  assert.equal(compareVersions('nightly', '0.0.1'), -1); assert.equal(compareVersions('0.0.1', 'x'), 1); assert.equal(parseVersion('1.2'), null);
});

test('shellKeyOf: stable, order-independent, changes with Electron or dependencies', () => {
  assert.equal(KEY, shellKeyOf({ electron: '33.4.11', dependencies: { a: '^2', b: '^1' } }));
  assert.notEqual(KEY, shellKeyOf({ electron: '34.0.0', dependencies: { a: '^2', b: '^1' } }));
  assert.notEqual(KEY, shellKeyOf({ electron: '33.4.11', dependencies: { a: '^2', b: '^1', c: '^1' } }));
});

test('pack/unpack: byte-exact round trip (binary files included), manifest written', () => {
  const root = fakeApp(), b = packBundle({ rootDir: root, version: '0.2.1', shellKey: KEY, notes: 'hi' });
  assert.equal(b.manifest.files, 5);
  const dest = tmp(), mf = unpackBundle(b.gz, dest);
  assert.equal(mf.version, '0.2.1');
  assert.deepEqual([...fs.readFileSync(path.join(dest, 'src/renderer/fonts/f.woff2'))], [0, 255, 7, 1]);
  assert.equal(fs.readFileSync(path.join(dest, 'src/main/main.js'), 'utf8'), '// 0.2.1');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8')).shellKey, KEY);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8')).type, 'module', 'staged code must load as ES modules');
});

test('unpack refuses: path traversal, absolute paths, non-src files, missing core files, bad manifests, junk, oversize', () => {
  for (const bad of ['../evil.js', 'src/../../evil.js', '/etc/passwd', 'src\\..\\x', 'package.json', 'src/./a/../b', 'src/a\0b']) {
    assert.equal(validRelPath(bad), false, bad);
    assert.throws(() => unpackBundle(rawBundle({ ...OK, [bad]: 'eA==' }), tmp()), /unsafe path/, bad);
  }
  assert.throws(() => unpackBundle(rawBundle({ 'src/main/main.js': '' }), tmp()), /incomplete/);
  assert.throws(() => unpackBundle(rawBundle(OK, { version: 'latest', shellKey: KEY }), tmp()), /manifest/);
  assert.throws(() => unpackBundle(Buffer.from('not gzip'), tmp()), /damaged/);
  assert.throws(() => unpackBundle(rawBundle({ ...OK, 'src/big.bin': Buffer.alloc(200000).toString('base64') }), tmp(), { maxBytes: 1000 }), /damaged|too large/);
  const dest = tmp(); assert.throws(() => unpackBundle(rawBundle({ ...OK, '../escape.txt': 'eA==' }), path.join(dest, 'x')));
  assert.equal(fs.existsSync(path.join(dest, 'escape.txt')), false);
});

test('chooseUpdate: only a newer, same-shell, intact, not-bad update is chosen', () => {
  const dir = tmp(), root = fakeApp('0.3.0');
  assert.equal(chooseUpdate({ dir, bundledVersion: '0.2.0', shellKey: KEY }), null, 'nothing staged');
  const b = packBundle({ rootDir: root, version: '0.3.0', shellKey: KEY }); unpackBundle(b.gz, path.join(dir, '0.3.0'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ready: '0.3.0' }));
  assert.equal(chooseUpdate({ dir, bundledVersion: '0.2.0', shellKey: KEY })?.version, '0.3.0');
  assert.equal(chooseUpdate({ dir, bundledVersion: '0.3.0', shellKey: KEY }), null, 'the installer caught up: not newer');
  assert.equal(chooseUpdate({ dir, bundledVersion: '0.4.0', shellKey: KEY }), null, 'never a downgrade');
  assert.equal(chooseUpdate({ dir, bundledVersion: '0.2.0', shellKey: 'other-shell' }), null, 'built for another shell');
  fs.rmSync(path.join(dir, '0.3.0/src/main/main.js')); assert.equal(chooseUpdate({ dir, bundledVersion: '0.2.0', shellKey: KEY }), null, 'files missing');
});

test('launch protocol: an update that never confirms is marked bad and not retried; a confirmed one is kept', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ready: '0.3.0' }));
  beginLaunch(dir, '0.3.0');
  assert.equal(readState(dir).pending, '0.3.0');
  assert.equal(reconcileCrash(dir), '0.3.0', 'next start sees an unconfirmed launch');
  let st = readState(dir); assert.deepEqual([st.ready, st.pending, st.bad], [null, null, ['0.3.0']]);
  assert.equal(reconcileCrash(dir), null);
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ready: '0.4.0' }));
  beginLaunch(dir, '0.4.0'); markVerified(dir, '0.4.0');
  assert.equal(reconcileCrash(dir), null, 'confirmed launches are fine'); st = readState(dir);
  assert.deepEqual([st.ready, st.verified, st.pending], ['0.4.0', '0.4.0', null]);
  markBad(dir, '0.4.0'); assert.deepEqual([readState(dir).ready, readState(dir).bad], [null, ['0.4.0']]);
  fs.writeFileSync(path.join(dir, 'state.json'), '{broken'); assert.deepEqual(readState(dir).bad, [], 'a corrupt state file reads as empty');
});

// ---- GitHub side, with a fake fetch ----
const resp = (body) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => { const b = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });
function fakeRelease({ version = '0.3.0', shellKey = KEY, tamper = false, noManifest = false } = {}) {
  const root = fakeApp(version), b = packBundle({ rootDir: root, version, shellKey });
  const file = `hhlab-update-${version}.json.gz`;
  const update = { version, shellKey, file, sha256: b.sha256, notes: 'Fixes' };
  const release = { tag_name: `v${version}`, html_url: 'https://example/release', assets: [...(noManifest ? [] : [{ name: 'update.json', browser_download_url: 'https://dl/update.json' }]), { name: file, browser_download_url: `https://dl/${file}` }] };
  const fetchFn = async (url) => (url.endsWith('/latest') ? resp(release) : url.endsWith('update.json') ? resp(update) : url.endsWith('.json.gz') ? resp(tamper ? Buffer.concat([b.gz, Buffer.from('x')]) : b.gz) : { ok: false, status: 404 });
  return { fetchFn, api: 'https://api/latest', version };
}

test('checkLatest: available / none / needs-installer / no manifest', async () => {
  const r = fakeRelease();
  const a = await checkLatest({ fetchFn: r.fetchFn, api: r.api, currentVersion: '0.2.0', shellKey: KEY });
  assert.equal(a.status, 'available'); assert.equal(a.version, '0.3.0'); assert.match(a.sha256, /^[0-9a-f]{64}$/); assert.equal(a.notes, 'Fixes');
  assert.equal((await checkLatest({ fetchFn: r.fetchFn, api: r.api, currentVersion: '0.3.0', shellKey: KEY })).status, 'none', 'already current');
  assert.equal((await checkLatest({ fetchFn: r.fetchFn, api: r.api, currentVersion: '0.2.0', shellKey: 'different' })).status, 'needs-installer');
  const n = fakeRelease({ noManifest: true });
  assert.equal((await checkLatest({ fetchFn: n.fetchFn, api: n.api, currentVersion: '0.1.0', shellKey: KEY })).status, 'none');
  await assert.rejects(checkLatest({ fetchFn: async () => ({ ok: false, status: 403 }), api: 'x', currentVersion: '0.1.0', shellKey: KEY }), /403/);
});

test('stageUpdate: downloads, verifies, stages, becomes ready; tampered or wrong-shell files never do', async () => {
  const dir = tmp(), r = fakeRelease();
  const info = await checkLatest({ fetchFn: r.fetchFn, api: r.api, currentVersion: '0.2.0', shellKey: KEY });
  fs.mkdirSync(path.join(dir, '0.2.5')); // an old staged version gets pruned unless kept
  await stageUpdate({ fetchFn: r.fetchFn, info, dir, shellKey: KEY });
  assert.equal(readState(dir).ready, '0.3.0'); assert.equal(fs.existsSync(path.join(dir, '0.2.5')), false);
  assert.equal(chooseUpdate({ dir, bundledVersion: '0.2.0', shellKey: KEY })?.version, '0.3.0');

  const t = fakeRelease({ tamper: true }), d2 = tmp();
  const ti = await checkLatest({ fetchFn: t.fetchFn, api: t.api, currentVersion: '0.2.0', shellKey: KEY });
  await assert.rejects(stageUpdate({ fetchFn: t.fetchFn, info: ti, dir: d2, shellKey: KEY }), /checksum/);
  assert.equal(readState(d2).ready, null); assert.deepEqual(fs.readdirSync(d2), [], 'nothing left behind');

  // a bundle whose manifest says another shell, even with a matching hash, is refused
  const w = fakeRelease({ shellKey: 'other' }), d3 = tmp();
  await assert.rejects(stageUpdate({ fetchFn: w.fetchFn, info: { ...(await checkLatest({ fetchFn: w.fetchFn, api: w.api, currentVersion: '0.2.0', shellKey: 'other' })) }, dir: d3, shellKey: KEY }), /different version of the app shell/);
  assert.equal(readState(d3).ready, null);
});
