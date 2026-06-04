import { describe, it, expect } from 'vitest';
import { scrub, scrubToJson, REDACTED } from './scrub';

describe('scrub', () => {
  it('redacts unambiguous substring-matched keys', () => {
    const out = scrub({
      password: 'hunter2',
      secretKey: 'sk_live_123',
      api_key: 'sk_live_456',
      Authorization: 'Bearer xxx',
      cookie: 'session=abc',
      privateKey: 'priv',
      accessToken: 'act',
      cvc: '123',
      iban: 'DE89...',
      cardNumber: '4242424242424242',
    }) as Record<string, string>;

    for (const v of Object.values(out)) expect(v).toBe(REDACTED);
  });

  it('redacts exact-match keys but keeps look-alikes intact', () => {
    const out = scrub({
      code: '123456',          // MFA code  -> redacted
      failureCode: 'card_declined',  // not redacted
      errorCode: 'INVALID',          // not redacted
      countryCode: 'US',             // not redacted
      mfa_code: '654321',            // redacted
      pan: '4242424242424242',       // redacted (also matches card number regex)
      panel: 'admin',                // NOT redacted (only exact 'pan' matches)
      ssn: '123-45-6789',
    }) as Record<string, string>;

    expect(out.code).toBe(REDACTED);
    expect(out.failureCode).toBe('card_declined');
    expect(out.errorCode).toBe('INVALID');
    expect(out.countryCode).toBe('US');
    expect(out.mfa_code).toBe(REDACTED);
    expect(out.pan).toBe(REDACTED);
    expect(out.panel).toBe('admin');
    expect(out.ssn).toBe(REDACTED);
  });

  it('walks nested objects and arrays', () => {
    const out = scrub({
      user: { email: 'a@b.com', password: 'x' },
      payments: [
        { paymentMethodId: 'pm_123', amount: 1000 },
        { paymentMethodId: 'pm_456', amount: 2000 },
      ],
    }) as any;

    expect(out.user.email).toBe('a@b.com');
    expect(out.user.password).toBe(REDACTED);
    expect(out.payments[0].paymentMethodId).toBe(REDACTED);
    expect(out.payments[0].amount).toBe(1000);
    expect(out.payments[1].paymentMethodId).toBe(REDACTED);
  });

  it('masks card-number-shaped string values regardless of key', () => {
    const out = scrub({
      note: '4242 4242 4242 4242',
      hint: '4242-4242-4242-4242',
      legitText: 'order id 12345',
    }) as Record<string, string>;
    expect(out.note).toBe(REDACTED);
    expect(out.hint).toBe(REDACTED);
    expect(out.legitText).toBe('order id 12345');
  });

  it('caps recursion depth without throwing on cycles', () => {
    const a: any = { name: 'a' };
    a.self = a;
    expect(() => scrub(a)).not.toThrow();
  });

  it('scrubToJson returns null for empty inputs', () => {
    expect(scrubToJson(undefined)).toBeNull();
    expect(scrubToJson(null)).toBeNull();
    expect(scrubToJson({})).toBeNull();
  });

  it('scrubToJson stringifies the redacted output', () => {
    const json = scrubToJson({ secret: 'x', name: 'y' })!;
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ secret: REDACTED, name: 'y' });
  });
});
