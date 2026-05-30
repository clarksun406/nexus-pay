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

export function encrypt(plaintext: string): string {
  if (!config.encryption.key) return plaintext;
  const key = Buffer.from(config.encryption.key, 'base64');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  if (!config.encryption.key) return ciphertext;
  const key = Buffer.from(config.encryption.key, 'base64');
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
