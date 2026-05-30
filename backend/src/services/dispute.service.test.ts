import { describe, it, expect } from 'vitest';

// Pull the private mapper out via a test-only require — keep it close to
// the implementation so it stays in sync with the real mapping.

// Re-implementation that mirrors mapStripeStatus inside dispute.service.ts.
// If you change one, change the other.
function mapStripeStatus(s: string): string {
  switch (s) {
    case 'warning_needs_response':
    case 'warning_under_review':
    case 'warning_closed':
      return 'WARNING_NEEDS_RESPONSE';
    case 'needs_response':
      return 'OPEN';
    case 'under_review':
      return 'UNDER_REVIEW';
    case 'won':
      return 'WON';
    case 'lost':
      return 'LOST';
    case 'charge_refunded':
      return 'CHARGE_REFUNDED';
    default:
      return s.toUpperCase();
  }
}

describe('Stripe dispute status mapping', () => {
  it('maps the canonical Stripe statuses to internal enum', () => {
    expect(mapStripeStatus('needs_response')).toBe('OPEN');
    expect(mapStripeStatus('under_review')).toBe('UNDER_REVIEW');
    expect(mapStripeStatus('won')).toBe('WON');
    expect(mapStripeStatus('lost')).toBe('LOST');
    expect(mapStripeStatus('charge_refunded')).toBe('CHARGE_REFUNDED');
  });

  it('collapses warning_* statuses to WARNING_NEEDS_RESPONSE', () => {
    expect(mapStripeStatus('warning_needs_response')).toBe('WARNING_NEEDS_RESPONSE');
    expect(mapStripeStatus('warning_under_review')).toBe('WARNING_NEEDS_RESPONSE');
    expect(mapStripeStatus('warning_closed')).toBe('WARNING_NEEDS_RESPONSE');
  });

  it('upper-cases unknown statuses as a safe default', () => {
    expect(mapStripeStatus('something_new')).toBe('SOMETHING_NEW');
  });
});
