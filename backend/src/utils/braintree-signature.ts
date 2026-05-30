import crypto from 'crypto';

/**
 * Verifies a Braintree webhook signature.
 *
 * Braintree's webhook scheme delivers two form fields:
 *   bt_signature: "<publicKey>|<sigHex>"   (multiple pairs allowed, pipe-separated triplet sets)
 *   bt_payload:   "<base64-encoded XML>"
 *
 * The signature is computed as:
 *   sig = HMAC-SHA1( SHA1(privateKey), bt_payload ).hex
 *
 * Returns the matched publicKey (so the caller can locate the right
 * connector) when verification succeeds, or a reason on failure.
 */
export function verifyBraintreeSignature(
  btSignature: string | undefined,
  btPayload: string | undefined,
  /** Map of publicKey → privateKey for all configured Braintree connectors. */
  keyring: Record<string, string>,
): { valid: boolean; matchedPublicKey?: string; reason?: string } {
  if (!btSignature) return { valid: false, reason: 'Missing bt_signature' };
  if (!btPayload) return { valid: false, reason: 'Missing bt_payload' };

  // bt_signature is a list of "publicKey|sig" pairs; we pick the one whose
  // publicKey we have a privateKey for, then HMAC-verify against the payload.
  const pairs = btSignature.split('&').flatMap((p) => p.split(','));
  for (const pair of pairs) {
    const idx = pair.indexOf('|');
    if (idx <= 0) continue;
    const pubKey = pair.slice(0, idx);
    const sigHex = pair.slice(idx + 1);
    const privKey = keyring[pubKey];
    if (!privKey) continue;

    const hashedKey = crypto.createHash('sha1').update(privKey).digest();
    const expected = crypto.createHmac('sha1', hashedKey).update(btPayload).digest('hex');

    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(sigHex);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return { valid: true, matchedPublicKey: pubKey };
      }
    } catch {
      // fall through and try the next pair
    }
  }

  return { valid: false, reason: 'No matching signature' };
}

/**
 * Extracts a Braintree notification XML payload's outer event kind without
 * a full XML parser. Looks for `<kind>...</kind>`. Returns `''` when absent.
 */
export function extractBraintreeKind(xml: string): string {
  const m = xml.match(/<kind>([^<]+)<\/kind>/);
  return m ? m[1].trim() : '';
}
