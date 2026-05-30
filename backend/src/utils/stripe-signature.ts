import crypto from 'crypto';

/**
 * Verifies a Stripe webhook signature against the raw request body.
 *
 * Stripe sends a header of the form:
 *   Stripe-Signature: t=<unix-ts>,v1=<hex sha256>
 *
 * We re-derive the v1 signature as `HMAC-SHA256(secret, "<t>.<rawBody>")`
 * and compare in constant time. The timestamp is also bounded by a tolerance
 * window to defeat replay attacks.
 *
 * Pulled out of the route handler so it can be unit-tested without spinning
 * up Express.
 */

export interface VerifyOptions {
  toleranceSeconds?: number;
  /** Override clock (for tests). */
  now?: () => number;
}

export function verifyStripeSignature(
  rawBody: Buffer,
  sigHeader: string | undefined,
  secret: string,
  opts: VerifyOptions = {},
): { valid: boolean; reason?: string } {
  const tolerance = opts.toleranceSeconds ?? 300;
  const now = opts.now ? opts.now() : Math.floor(Date.now() / 1000);

  if (!secret) return { valid: false, reason: 'Webhook secret not configured' };
  if (!sigHeader) return { valid: false, reason: 'Missing signature header' };

  const parts = sigHeader.split(',').reduce((acc: Record<string, string>, part) => {
    const idx = part.indexOf('=');
    if (idx > 0) acc[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    return acc;
  }, {});

  const timestamp = parts['t'];
  const v1 = parts['v1'];
  if (!timestamp || !v1) return { valid: false, reason: 'Malformed signature header' };

  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts)) return { valid: false, reason: 'Malformed signature header' };
  if (Math.abs(now - ts) > tolerance) {
    return { valid: false, reason: 'Signature timestamp outside tolerance' };
  }

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  try {
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(v1);
    if (expectedBuf.length !== providedBuf.length) return { valid: false, reason: 'Signature mismatch' };
    if (!crypto.timingSafeEqual(expectedBuf, providedBuf)) return { valid: false, reason: 'Signature mismatch' };
  } catch {
    return { valid: false, reason: 'Signature comparison failed' };
  }

  return { valid: true };
}
