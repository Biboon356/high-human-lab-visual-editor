// The installed app's folder (its package.json and node_modules). Updated code runs from the user's data folder, where Node cannot
// find the app's dependencies by itself, so everything native (ffmpeg, whisper) is resolved from here.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const appRoot = globalThis.__hhAppRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const appRequire = createRequire(path.join(appRoot, 'package.json'));
