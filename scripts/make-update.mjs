// Builds the in-app update bundle for a release: dist-update/hhlab-update-<version>.json.gz + dist-update/update.json.
// Usage: VERSION=0.3.0 NOTES="what changed" node scripts/make-update.mjs      (VERSION defaults to package.json)
// The shell key must equal what the installed app computes at runtime: Electron's version + the package.json dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packBundle, shellKeyOf, parseVersion } from '../src/main/update-core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const electron = lock.packages?.['node_modules/electron']?.version;
if (!electron) throw new Error('Could not find the pinned Electron version in package-lock.json');
const version = String(process.env.VERSION || pkg.version).replace(/^v/, '');
if (!parseVersion(version)) throw new Error(`"${version}" is not a x.y.z version`);

const shellKey = shellKeyOf({ electron, dependencies: pkg.dependencies });
const { gz, sha256, manifest } = packBundle({ rootDir: root, version, shellKey, notes: (process.env.NOTES || '').trim().slice(0, 2000) });
const out = path.join(root, 'dist-update');
fs.mkdirSync(out, { recursive: true });
const file = `hhlab-update-${version}.json.gz`;
fs.writeFileSync(path.join(out, file), gz);
fs.writeFileSync(path.join(out, 'update.json'), JSON.stringify({ version, shellKey, file, sha256, notes: manifest.notes }, null, 2));
console.log(`update ${version}: ${manifest.files} files, ${(gz.length / 1024).toFixed(0)} KiB, shell ${shellKey} (electron ${electron}), sha256 ${sha256.slice(0, 12)}…`);
