import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { downloadFile } from '../src/main/model-download.js';

const payload = crypto.randomBytes(300_000);
const open = [];
function server(handler) {
  return new Promise((res) => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => { open.push(s); res({ s, url: `http://127.0.0.1:${s.address().port}` }); }); });
}
// close every test server even when an assertion fails, otherwise the runner never exits
test.after(() => { for (const s of open) { s.closeAllConnections?.(); s.close(); } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-dl-'));

test('downloads a file with progress, checks the length, and is idempotent', async (t) => {
  const { s, url } = await server((req, res) => { res.writeHead(200, { 'Content-Length': payload.length }); res.end(payload); });
  const dest = path.join(tmp(), 'm.bin'); const seen = [];
  await downloadFile({ url: `${url}/m.bin`, dest, onProgress: (p) => seen.push(p.received) });
  assert.ok(fs.readFileSync(dest).equals(payload)); assert.ok(seen.length && seen.at(-1) === payload.length);
  assert.equal(fs.existsSync(`${dest}.part`), false);
  let hits = 0; s.on('request', () => hits++);
  await downloadFile({ url: `${url}/m.bin`, dest }); assert.equal(hits, 0, 'a complete file is not downloaded again');
  
});

test('follows redirects and resumes a partial download with a Range request', async (t) => {
  const ranges = [];
  const { s, url } = await server((req, res) => {
    if (req.url === '/hop') { res.writeHead(302, { Location: '/real' }); return res.end(); }
    ranges.push(req.headers.range || null);
    const m = /bytes=(\d+)-/.exec(req.headers.range || '');
    if (m) { const from = Number(m[1]); res.writeHead(206, { 'Content-Length': payload.length - from, 'Content-Range': `bytes ${from}-${payload.length - 1}/${payload.length}` }); return res.end(payload.subarray(from)); }
    res.writeHead(200, { 'Content-Length': payload.length }); res.end(payload);
  });
  const dir = tmp(), dest = path.join(dir, 'm.bin');
  fs.writeFileSync(`${dest}.part`, payload.subarray(0, 120_000));
  await downloadFile({ url: `${url}/hop`, dest });
  assert.ok(fs.readFileSync(dest).equals(payload), 'resumed bytes line up exactly');
  assert.deepEqual(ranges, ['bytes=120000-']);
  
});

test('a server that ignores Range restarts cleanly; truncated transfers and 404s are reported', async (t) => {
  const { s, url } = await server((req, res) => {
    if (req.url === '/trunc') { res.writeHead(200, { 'Content-Length': payload.length }); res.write(payload.subarray(0, 1000)); return res.destroy(); }
    if (req.url === '/small') { res.writeHead(200, { 'Content-Length': 5 }); return res.end('error'); }
    if (req.url === '/missing') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Length': payload.length }); res.end(payload); // ignores Range
  });
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.bin.part'), payload.subarray(0, 5000));
  await downloadFile({ url: `${url}/ok`, dest: path.join(dir, 'a.bin') });
  assert.ok(fs.readFileSync(path.join(dir, 'a.bin')).equals(payload), 'restarted from zero, no corrupted splice');
  await assert.rejects(downloadFile({ url: `${url}/trunc`, dest: path.join(dir, 'b.bin') }), /resume|incomplete/i);
  assert.equal(fs.existsSync(path.join(dir, 'b.bin')), false, 'a truncated file is never promoted to the real name');
  await assert.rejects(downloadFile({ url: `${url}/small`, dest: path.join(dir, 'c.bin'), minBytes: 1000 }), /too small/);
  await assert.rejects(downloadFile({ url: `${url}/missing`, dest: path.join(dir, 'd.bin') }), /404|not found/i);
  
});

test('cancel aborts without leaving a finished file', async (t) => {
  const { s, url } = await server((req, res) => { res.writeHead(200, { 'Content-Length': payload.length * 10 }); let n = 0; const iv = setInterval(() => { res.write(payload); if (++n >= 10) { clearInterval(iv); res.end(); } }, 20); res.on('close', () => clearInterval(iv)); });
  const dest = path.join(tmp(), 'x.bin'); const signal = { aborted: false };
  await assert.rejects(downloadFile({ url: `${url}/x`, dest, signal, onProgress: (p) => { if (p.received > 500_000) signal.aborted = true; } }), /cancel/i);
  assert.equal(fs.existsSync(dest), false); 
});
