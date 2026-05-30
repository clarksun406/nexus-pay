import { describe, it, expect } from 'vitest';
import { computeFee } from './fee-calculator';

describe('computeFee', () => {
  it('returns 0 when no config is provided', () => {
    expect(computeFee(1000, null)).toBe(0);
    expect(computeFee(1000, undefined as any)).toBe(0);
    expect(computeFee(1000, {})).toBe(0);
  });

  it('returns 0 for non-positive amounts', () => {
    expect(computeFee(0, { fixed: 30, percentage: 2.9 })).toBe(0);
    expect(computeFee(-10, { fixed: 30, percentage: 2.9 })).toBe(0);
  });

  it('applies fixed + percentage with rounding', () => {
    // 1000 * 2.9% = 29 + fixed 30 = 59
    expect(computeFee(1000, { fixed: 30, percentage: 2.9 })).toBe(59);
    // 999 * 2.9% = 28.971 -> 29 (round) + 30 = 59
    expect(computeFee(999, { fixed: 30, percentage: 2.9 })).toBe(59);
  });

  it('handles fixed-only and percentage-only configs', () => {
    expect(computeFee(500, { fixed: 25 })).toBe(25);
    expect(computeFee(2000, { percentage: 3 })).toBe(60);
  });

  it('caps the fee at the charge amount', () => {
    expect(computeFee(50, { fixed: 100, percentage: 0 })).toBe(50);
  });

  it('ignores negative values in config', () => {
    expect(computeFee(1000, { fixed: -50, percentage: 2.9 })).toBe(0);
    expect(computeFee(1000, { fixed: 30, percentage: -1 })).toBe(0);
  });
});
