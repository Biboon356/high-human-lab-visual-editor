import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { interpretWithClaude, buildPayload, AI_MODELS, DEFAULT_AI_MODEL } from '../src/main/ai.js';
import { createKeyStore } from '../src/main/ai-key.js';

const GOOD = { notes: 'Read as a warm dream.', candidates: ['Gentle', 'Balanced', 'Bold'].map((t, i) => ({ title: `Dream · ${t}`, summary: 's', effects: [
  { type: 'bloom', params: [{ key: 'intensity', value: 0.3 + i * 0.3 }], links: [] }, { type: 'grain', params: [{ key: 'amount', value: 0.2 }], links: [{ key: 'amount', signal: 'bass', amount: 0.4 }] }] })) };

async function server(handler) {
  const seen = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { seen.push({ url: req.url, headers: req.headers, body: b ? JSON.parse(b) : null }); handler(req, res, seen); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }) };
}
const message = (text, stop = 'end_turn') => JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
const ok = (text, stop) => (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(message(text, stop)); };
const err = (status, type, msg) => (req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type, message: msg } })); };

test('a good answer becomes plans; the request carries the sentence, the catalogue and the structured-output format, and nothing about files', async () => {
  const s = await server(ok(JSON.stringify(GOOD)));
  const r = await interpretWithClaude({ apiKey: 'sk-ant-test-key-0123456789', baseURL: s.url, input: { text: 'ฉากเหมือนฝันตอนบ่าย', clipEffects: ['grain'] } });
  assert.ok(r.ok, r.reason);
  assert.equal(r.plans.length, 3); assert.equal(r.plans[1].source, 'ai'); assert.deepEqual(r.plans[1].chain.find((c) => c.type === 'grain').bindings.amount, { source: 'bass', amount: 0.4 });
  const q = s.seen[0];
  assert.equal(q.url, '/v1/messages'); assert.ok(`${q.headers['x-api-key'] || ''} ${q.headers.authorization || ''}`.includes('sk-ant-test-key-0123456789'), 'the key travels in the auth header the SDK chose');
  assert.equal(q.body.model, DEFAULT_AI_MODEL); assert.equal(q.body.output_config.format.type, 'json_schema');
  const sent = JSON.parse(q.body.messages[0].content);
  assert.equal(sent.request, 'ฉากเหมือนฝันตอนบ่าย'); assert.ok(sent.catalogue.length > 20); assert.deepEqual(sent.alreadyOnClip, ['grain']);
  assert.deepEqual(Object.keys(sent).sort(), ['alreadyOnClip', 'catalogue', 'request']);
  assert.ok(!/path|\.mov|\.mp4|file/i.test(q.body.messages[0].content.replace(/"label":"[^"]*"/g, '')), 'no file names or paths are sent');
  await s.close();
});

test('refinement sends the current look (names and numbers only), capped', () => {
  const p = buildPayload({ text: 'more grain', current: { title: 'T', effects: [{ type: 'grain', params: { amount: 0.4, color: '#fff', size: 2 } }, ...Array(20).fill({ type: 'blur', params: {} })] } });
  assert.equal(p.current.effects.length, 8); assert.deepEqual(p.current.effects[0].params, { amount: 0.4, size: 2 });
  assert.equal(buildPayload({ text: 'x'.repeat(5000) }).request.length, 600);
});

test('failures never throw: wrong key, rate limit, no connection, refusal, cut-off, unreadable answer, nothing usable', async () => {
  const run = async (handler, extra = {}) => { const s = await server(handler); const r = await interpretWithClaude({ apiKey: 'sk-ant-test-key-0123456789', baseURL: s.url, input: { text: 'dream' }, ...extra }); await s.close(); return r; };
  assert.equal((await run(err(401, 'authentication_error', 'invalid x-api-key'))).code, 'auth');
  assert.equal((await run(err(429, 'rate_limit_error', 'slow down'))).code, 'rate');
  assert.equal((await run(ok('{}', 'refusal'))).code, 'declined');
  assert.equal((await run(ok('{', 'max_tokens'))).code, 'cut');
  assert.equal((await run(ok('not json'))).code, 'bad-answer');
  assert.equal((await run(ok(JSON.stringify({ notes: '', candidates: [{ title: 'x', summary: '', effects: [{ type: 'made-up', params: [], links: [] }] }] })))).code, 'bad-answer');
  assert.equal((await run(err(400, 'invalid_request_error', 'model: unknown'))).code, 'error');
  const dead = await interpretWithClaude({ apiKey: 'sk-ant-test-key-0123456789', baseURL: 'http://127.0.0.1:9', input: { text: 'dream' } });
  assert.equal(dead.code, 'offline'); assert.match(dead.reason, /offline dictionary/);
  assert.equal((await interpretWithClaude({ apiKey: '', input: { text: 'x' } })).code, 'no-key');
  assert.equal((await interpretWithClaude({ apiKey: 'sk-ant-test-key-0123456789', model: 'gpt-4', input: { text: 'x' } })).ok, false);
  assert.equal((await interpretWithClaude({ apiKey: 'sk-ant-test-key-0123456789', input: { text: '   ' } })).ok, false);
  assert.ok(AI_MODELS[DEFAULT_AI_MODEL]);
}, { timeout: 60000 });

test('key store: encrypted on disk when the OS can, memory only when it cannot, never plaintext, bad keys refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-key-'));
  const fake = (avail) => ({ isEncryptionAvailable: () => avail, encryptString: (s) => Buffer.from(`ENC:${[...s].reverse().join('')}`), decryptString: (b) => [...b.toString().slice(4)].reverse().join('') });
  const key = 'sk-ant-api03-abcdefghijklmnop1234';
  let ks = createKeyStore({ dir, safeStorage: fake(true) });
  assert.equal(ks.has(), false); assert.equal(ks.set('nope').ok, false); assert.equal(ks.set('').ok, false);
  assert.deepEqual(ks.set(`  ${key}  `), { ok: true, storage: 'encrypted' });
  assert.ok(!fs.readFileSync(path.join(dir, 'ai-key.bin'), 'utf8').includes('abcdefgh'), 'the file does not contain the key in the clear');
  ks = createKeyStore({ dir, safeStorage: fake(true) });
  assert.equal(ks.has(), true); assert.equal(ks.get(), key);
  ks.clear(); assert.equal(ks.has(), false); assert.equal(ks.get(), null);
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'hhlab-key-'));
  const mem = createKeyStore({ dir: dir2, safeStorage: fake(false) });
  assert.deepEqual(mem.set(key), { ok: true, storage: 'memory' }); assert.equal(mem.get(), key); assert.equal(fs.readdirSync(dir2).length, 0, 'nothing written without encryption');
  assert.equal(createKeyStore({ dir: dir2, safeStorage: fake(false) }).has(), false, 'a new session starts without it');
});
