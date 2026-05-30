import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyBraintreeSignature, extractBraintreeKind } from './braintree-signature';

const PUB_KEY = 'pub_test_123';
const PRIV_KEY = 'priv_test_xyz';

function sign(payload: string, privKey: string) {
  const hashed = crypto.createHash('sha1').update(privKey).digest();
  return crypto.createHmac('sha1', hashed).update(payload).digest('hex');
}

describe('verifyBraintreeSignature', () => {
  const keyring = { [PUB_KEY]: PRIV_KEY };

  it('accepts a correctly-signed payload and returns the matched publicKey', () => {
    const payload = Buffer.from('<notification><kind>dispute_opened</kind></notification>').toString('base64');
    const sig = `${PUB_KEY}|${sign(payload, PRIV_KEY)}`;
    const r = verifyBraintreeSignature(sig, payload, keyring);
    expect(r.valid).toBe(true);
    expect(r.matchedPublicKey).toBe(PUB_KEY);
  });

  it('skips publicKeys not in the keyring and tries the next', () => {
    const payload = Buffer.from('<n/>').toString('base64');
    const otherSig = `unknown_pub|${sign(payload, PRIV_KEY)}`;
    const goodSig = `${PUB_KEY}|${sign(payload, PRIV_KEY)}`;
    // Multi-pair signature header
    const header = `${otherSig}&${goodSig}`;
    const r = verifyBraintreeSignature(header, payload, keyring);
    expect(r.valid).toBe(true);
    expect(r.matchedPublicKey).toBe(PUB_KEY);
  });

  it('rejects a tampered payload', () => {
    const payload = Buffer.from('<a/>').toString('base64');
    const sig = `${PUB_KEY}|${sign(payload, PRIV_KEY)}`;
    const tampered = Buffer.from('<b/>').toString('base64');
    const r = verifyBraintreeSignature(sig, tampered, keyring);
    expect(r.valid).toBe(false);
  });

  it('rejects when no publicKey in the header has a known privateKey', () => {
    const payload = Buffer.from('<n/>').toString('base64');
    const sig = `unknown|${sign(payload, PRIV_KEY)}`;
    const r = verifyBraintreeSignature(sig, payload, keyring);
    expect(r.valid).toBe(false);
  });

  it('rejects when fields are missing', () => {
    expect(verifyBraintreeSignature(undefined, 'x', keyring).valid).toBe(false);
    expect(verifyBraintreeSignature('x|y', undefined, keyring).valid).toBe(false);
  });
});

describe('extractBraintreeKind', () => {
  it('returns the kind tag value', () => {
    const xml = '<notification><kind>dispute_opened</kind><other/></notification>';
    expect(extractBraintreeKind(xml)).toBe('dispute_opened');
  });
  it('returns empty when missing', () => {
    expect(extractBraintreeKind('<notification/>')).toBe('');
  });
});
