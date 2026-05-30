import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// Fresh module load each test so config snapshots the env we just set.
async function loadModule() {
  // Force re-evaluation by clearing the require cache for both modules.
  const path = require.resolve('./crypto');
  const cfgPath = require.resolve('../config');
  delete require.cache[path];
  delete require.cache[cfgPath];
  return await import('./crypto');
}

describe('crypto utils', () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.ENCRYPTION_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = savedKey;
  });

  it('generates a deterministic SHA-256 hex hash', async () => {
    const { hashSha256 } = await loadModule();
    expect(hashSha256('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    expect(hashSha256('hello')).toBe(hashSha256('hello'));
    expect(hashSha256('hello')).not.toBe(hashSha256('Hello'));
  });

  it('round-trips encrypt/decrypt with a valid key', async () => {
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    const { encrypt, decrypt, isEncrypted, isEncryptionConfigured } = await loadModule();

    expect(isEncryptionConfigured()).toBe(true);
    const plaintext = '{"secretKey":"sk_live_xxx","extra":"💳"}';
    const ct = encrypt(plaintext);
    expect(ct).not.toBe(plaintext);
    expect(isEncrypted(ct)).toBe(true);
    expect(decrypt(ct)).toBe(plaintext);
  });

  it('encrypt() throws when ENCRYPTION_KEY is missing', async () => {
    delete process.env.ENCRYPTION_KEY;
    const { encrypt, isEncryptionConfigured } = await loadModule();
    expect(isEncryptionConfigured()).toBe(false);
    expect(() => encrypt('anything')).toThrow(/ENCRYPTION_KEY is not configured/);
  });

  it('encrypt() throws when key length is wrong', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16).toString('base64'); // 16 bytes, not 32
    const { encrypt } = await loadModule();
    expect(() => encrypt('x')).toThrow(/32 bytes/);
  });

  it('decrypt() passes legacy plaintext through unchanged', async () => {
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    const { decrypt } = await loadModule();
    expect(decrypt('this-is-not-an-encrypted-blob')).toBe('this-is-not-an-encrypted-blob');
  });

  it('isEncrypted() recognises only the produced shape', async () => {
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    const { encrypt, isEncrypted } = await loadModule();
    expect(isEncrypted(encrypt('payload'))).toBe(true);
    expect(isEncrypted('plain')).toBe(false);
    expect(isEncrypted('aa:bb:cc')).toBe(false); // wrong lengths
  });

  it('generateApiKey() produces a unique sk_/pk_ key whose hash matches', async () => {
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    const { generateApiKey, hashSha256 } = await loadModule();
    const a = generateApiKey('sk');
    const b = generateApiKey('sk');
    expect(a.raw.startsWith('sk_')).toBe(true);
    expect(a.hash).toHaveLength(64);
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).toBe(hashSha256(a.raw));
  });
});
