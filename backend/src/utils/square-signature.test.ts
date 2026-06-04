import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifySquareSignature } from './square-signature';

const KEY = 'square_webhook_signing_key';
const URL = 'https://example.com/webhooks/square';

function sign(url: string, body: string, key: string) {
  return crypto.createHmac('sha256', key).update(url + body).digest('base64');
}

describe('verifySquareSignature', () => {
  it('accepts a correctly-signed payload', () => {
    const body = '{"event_id":"e1"}';
    const sig = sign(URL, body, KEY);
    const r = verifySquareSignature(URL, Buffer.from(body), sig, KEY);
    expect(r.valid).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = '{"event_id":"e1"}';
    const sig = sign(URL, body, KEY);
    const r = verifySquareSignature(URL, Buffer.from('{"event_id":"e2"}'), sig, KEY);
    expect(r.valid).toBe(false);
  });

  it('rejects when the URL differs from the one Square signed', () => {
    const body = '{"event_id":"e1"}';
    const sig = sign(URL, body, KEY);
    const r = verifySquareSignature('https://example.com/webhooks/wrong', Buffer.from(body), sig, KEY);
    expect(r.valid).toBe(false);
  });

  it('rejects when the signing key is wrong', () => {
    const body = '{}';
    const sig = sign(URL, body, KEY);
    const r = verifySquareSignature(URL, Buffer.from(body), sig, 'other_key');
    expect(r.valid).toBe(false);
  });

  it('rejects when the header is missing', () => {
    const r = verifySquareSignature(URL, Buffer.from(''), undefined, KEY);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/missing/i);
  });

  it('rejects when the key is missing', () => {
    const r = verifySquareSignature(URL, Buffer.from(''), 'sig', '');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/not configured/i);
  });
});
