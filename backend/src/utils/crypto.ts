import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Placeholder password hash for users created via invitation who have not yet
 * set a password. It is intentionally not a valid bcrypt hash, so password
 * comparison always fails until the invite is accepted.
 */
export const INVITE_PASSWORD_SENTINEL = '!nexuspay-invite-pending!';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function hashSha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function generateApiKey(prefix: string): { raw: string; hash: string } {
  const random = crypto.randomBytes(32).toString('hex');
  const raw = `${prefix}_${random}`;
  const hash = hashSha256(raw);
  return { raw, hash };
}

// Encrypted payload shape: "<iv hex(32)>:<tag hex(32)>:<ciphertext hex>"
const ENCRYPTED_RE = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]*$/i;

export function isEncryptionConfigured(): boolean {
  return !!config.encryption.key;
}

/** Returns true if the value looks like a value produced by encrypt(). */
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && ENCRYPTED_RE.test(value);
}

/** Decode + validate the configured key. Throws if it is missing or not 32 bytes. */
function getEncryptionKey(): Buffer {
  if (!config.encryption.key) {
    throw new Error('ENCRYPTION_KEY is not configured. Set a base64-encoded 32-byte key (e.g. `openssl rand -base64 32`).');
  }
  const key = Buffer.from(config.encryption.key, 'base64');
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to 32 bytes for AES-256-GCM (got ${key.length}).`);
  }
  return key;
}

/** Validate the encryption key at startup. Warns (does not crash) when unset. */
export function assertEncryptionKey(): void {
  if (!config.encryption.key) {
    console.warn('[security] ENCRYPTION_KEY is not set — provider credentials cannot be stored until it is configured.');
    return;
  }
  getEncryptionKey(); // throws on invalid length
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  // Pass through legacy/plaintext values that were never encrypted.
  if (!isEncrypted(ciphertext)) return ciphertext;
  const key = getEncryptionKey();
  const [ivHex, tagHex, encrypted] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateSigningSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}
