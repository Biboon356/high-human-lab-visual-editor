// Where the user's own API key lives: encrypted with the operating system's keychain (Electron safeStorage) in the app's data folder.
// If encryption is not available on this computer the key is kept in memory for this session only: it is never written to disk in the clear.
import fs from 'node:fs';
import path from 'node:path';

export function createKeyStore({ dir, safeStorage }) {
  const file = path.join(dir, 'ai-key.bin');
  let mem = null;
  const canEncrypt = () => { try { return !!safeStorage?.isEncryptionAvailable(); } catch { return false; } };
  return {
    storage: () => (canEncrypt() ? 'encrypted' : 'memory'),
    has() { if (mem) return true; try { return fs.existsSync(file) && canEncrypt(); } catch { return false; } },
    get() {
      if (mem) return mem;
      try { if (!canEncrypt() || !fs.existsSync(file)) return null; return safeStorage.decryptString(Buffer.from(fs.readFileSync(file, 'utf8'), 'base64')); } catch { return null; }
    },
    set(key) {
      const k = String(key ?? '').trim();
      if (!/^sk-ant-[A-Za-z0-9_\-]{16,}$/.test(k)) return { ok: false, reason: 'That does not look like an Anthropic API key (it starts with sk-ant-).' };
      if (canEncrypt()) {
        try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, safeStorage.encryptString(k).toString('base64'), { mode: 0o600 }); mem = null; return { ok: true, storage: 'encrypted' }; }
        catch (e) { return { ok: false, reason: `The key could not be stored safely (${e.code || e.message}).` }; }
      }
      mem = k; return { ok: true, storage: 'memory' };
    },
    clear() { mem = null; try { fs.rmSync(file, { force: true }); } catch { /* nothing to remove */ } return true; },
  };
}
