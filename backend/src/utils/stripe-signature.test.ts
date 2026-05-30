import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyStripeSignature } from './stripe-signature';

const SECRET = 'whsec_test_secret_for_unit_tests_only';

function makeHeader(secret: string, body: string, ts: number) {
  const v1 = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return `t=${ts},v1=${v1}`;
}

describe('verifyStripeSignature', () => {
  const fixedNow = 1_700_000_000;
  const opts = { now: () => fixedNow };

  it('accepts a correctly-signed payload within the tolerance window', () => {
    const body = '{"id":"evt_1"}';
    const header = makeHeader(SECRET, body, fixedNow - 5);
    const result = verifyStripeSignature(Buffer.from(body), header, SECRET, opts);
    expect(result.valid).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = '{"id":"evt_1"}';
    const header = makeHeader(SECRET, body, fixedNow);
    const tampered = Buffer.from('{"id":"evt_2"}');
    const result = verifyStripeSignature(tampered, header, SECRET, opts);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/mismatch/i);
  });

  it('rejects when the secret is wrong', () => {
    const body = '{"id":"evt_1"}';
    const header = makeHeader(SECRET, body, fixedNow);
    const result = verifyStripeSignature(Buffer.from(body), header, 'whsec_other', opts);
    expect(result.valid).toBe(false);
  });

  it('rejects timestamps outside the tolerance window', () => {
    const body = '{"id":"evt_1"}';
    const old = fixedNow - 10_000; // way past 5 min
    const header = makeHeader(SECRET, body, old);
    const result = verifyStripeSignature(Buffer.from(body), header, SECRET, opts);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/tolerance/i);
  });

  it('rejects a malformed header', () => {
    const result = verifyStripeSignature(Buffer.from(''), 'no-equals-sign', SECRET, opts);
    expect(result.valid).toBe(false);
  });

  it('rejects a missing header', () => {
    const result = verifyStripeSignature(Buffer.from(''), undefined, SECRET, opts);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing/i);
  });

  it('rejects when no secret is configured', () => {
    const result = verifyStripeSignature(Buffer.from(''), 't=1,v1=abc', '', opts);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not configured/i);
  });
});
