/**
 * Recursively redacts sensitive values from an arbitrary JSON-like value.
 *
 * Designed for `gateway_logs` so we never persist payment-method tokens,
 * card data, API keys, or auth headers.
 *
 * Two-tier matching keeps the noise low:
 *   - SUBSTRING patterns: any key containing them (case-insensitive) is
 *     redacted. These are unambiguous tokens like `secret`, `password`.
 *   - EXACT patterns: must match the key name exactly (after lowercasing
 *     and dropping `_`/`-`). Used for short ambiguous tokens like `code`
 *     so we don't redact things like `failureCode` or `countryCode`.
 *
 * In addition, any string value that *looks like* a card number (13–19
 * digits, possibly spaced or dashed) is masked regardless of its key name.
 */

export const REDACTED = '[REDACTED]';

const SUBSTRING_KEYS = [
  'password',
  'secret',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'sessionid',
  'session_id',
  'privatekey',
  'private_key',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'webhooksignaturekey',
  'webhook_signature_key',
  'paymentmethodid',
  'payment_method_id',
  'sourceid',
  'source_id',
  'cvc',
  'cvv',
  'cardnumber',
  'card_number',
  'iban',
];

const EXACT_KEYS = new Set([
  'token',           // generic auth/session token
  'code',            // MFA / OTP code
  'mfacode',
  'mfa_code',
  'totp',
  'pin',
  'ssn',
  'pan',
  'routingnumber',
  'routing_number',
  'accountnumber',
  'account_number',
  'backupcode',
  'backup_code',
  'plaintextkey',
  'plaintext_key',
]);

const CARD_NUMBER_RE = /^[\s-]*(?:\d[\s-]*){13,19}$/;

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SUBSTRING_KEYS.some((p) => k.includes(p))) return true;
  return EXACT_KEYS.has(normaliseKey(key));
}

function looksLikeCardNumber(v: unknown): boolean {
  return typeof v === 'string' && CARD_NUMBER_RE.test(v);
}

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 12) return REDACTED;
  if (value == null) return value;
  if (typeof value !== 'object') {
    return looksLikeCardNumber(value) ? REDACTED : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrub(v, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(k)) {
      out[k] = REDACTED;
      continue;
    }
    out[k] = scrub(v, depth + 1);
  }
  return out;
}

/** Convenience: scrub then JSON-stringify, returning null for empty inputs. */
export function scrubToJson(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'object' && Object.keys(value as object).length === 0) return null;
  try {
    return JSON.stringify(scrub(value));
  } catch {
    return null;
  }
}
