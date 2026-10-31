// Resumable, verified model downloads. No Electron dependency (unit-testable against a local HTTP server).
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

function request(url, headers, redirects = 6) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'HIGH-HUMAN-LAB', Connection: 'close', ...headers } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Too many redirects while downloading the model.'));
        return resolve(request(new URL(res.headers.location, url).toString(), headers, redirects - 1));
      }
      resolve(res);
    });
    req.on('error', (e) => reject(new Error(
      e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN' ? 'Cannot reach the download server — check your internet connection.'
        : `The connection dropped before the model finished (${e.code || e.message}); run it again to resume.`)));
    req.setTimeout(30000, () => req.destroy(new Error('The download server stopped responding.')));
  });
}

/**
 * Downloads `url` to `dest`, resuming a previous `.part` file when the server supports ranges.
 * Resolves with the final path only if the byte count matches what the server promised (and `minBytes`, if given).
 * @param {{url:string, dest:string, minBytes?:number, onProgress?:(p:{received:number,total:number})=>void, signal?:{aborted:boolean}}} o
 */
export async function downloadFile({ url, dest, minBytes = 0, onProgress, signal }) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size >= Math.max(1, minBytes)) return dest; // already complete
  const part = `${dest}.part`;
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const res = await request(url, have ? { Range: `bytes=${have}-` } : {});
  if (res.statusCode === 416) { // our partial file is already the whole thing (or stale)
    res.resume(); fs.rmSync(part, { force: true }); return downloadFile({ url, dest, minBytes, onProgress, signal });
  }
  if (res.statusCode !== 200 && res.statusCode !== 206) {
    res.resume();
    throw new Error(`Download failed: the server answered ${res.statusCode}${res.statusCode === 404 ? ' (model not found at that address)' : ''}.`);
  }
  const resumed = res.statusCode === 206;
  if (!resumed) have = 0; // server ignored the Range header: start over
  const total = have + Number(res.headers['content-length'] || 0);
  const out = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' });
  let received = have;
  await new Promise((resolve, reject) => {
    res.on('data', (chunk) => {
      received += chunk.length;
      if (signal?.aborted) { res.destroy(new Error('Download cancelled.')); return; }
      onProgress?.({ received, total });
    });
    res.on('error', reject);
    res.on('aborted', () => reject(new Error(signal?.aborted ? 'Download cancelled.' : 'The connection dropped; run it again to resume.')));
    out.on('error', reject);
    out.on('finish', resolve);
    res.pipe(out);
  }).catch((e) => { out.destroy(); throw e; });
  const size = fs.statSync(part).size;
  if (total && size !== total) throw new Error(`Download incomplete (${size} of ${total} bytes). Run it again to resume.`);
  if (size < minBytes) { fs.rmSync(part, { force: true }); throw new Error(`The downloaded file is too small (${size} bytes) — not a valid model.`); }
  fs.renameSync(part, dest);
  return dest;
}
