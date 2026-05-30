import crypto from 'crypto';

/**
 * Verifies a Square webhook signature.
 *
 * Square computes:
 *   signature = base64( HMAC-SHA256(signatureKey, notificationUrl + rawBody) )
 *
 * The result is sent in the `x-square-hmacsha256-signature` request header.
 * `notificationUrl` is the public URL Square was configured to POST to —
 * we receive it from the caller (typically `${PAY_BASE_URL}/webhooks/square`)
 * because we can't reliably reconstruct it from req.url behind a proxy.
 */
export function verifySquareSignature(
  notificationUrl: string,
  rawBody: Buffer,
  signatureHeader: string | undefined,
  signatureKey: string,
): { valid: boolean; reason?: string } {
  if (!signatureKey) return { valid: false, reason: 'Webhook signature key not configured' };
  if (!signatureHeader) return { valid: false, reason: 'Missing signature header' };

  const expected = crypto
    .createHmac('sha256', signatureKey)
    .update(notificationUrl + rawBody.toString('utf8'))
    .digest('base64');

  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length) return { valid: false, reason: 'Signature mismatch' };
    if (!crypto.timingSafeEqual(a, b)) return { valid: false, reason: 'Signature mismatch' };
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Signature comparison failed' };
  }
}
