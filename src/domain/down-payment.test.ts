import { describe, expect, it } from 'vitest';
import { downPaymentIsAdjustable, MIN_DOWN_PAYMENT_RANGE_CENTS } from './down-payment';

describe('downPaymentIsAdjustable', () => {
  it('hides the slider when only a few euros could be paid down', () => {
    // €303.00 item, band A starts at €300.00: at most €3.00 down.
    expect(downPaymentIsAdjustable(0, 300)).toBe(false);
    expect(downPaymentIsAdjustable(0, 0)).toBe(false);
  });

  it('shows it from a €50.00 range up', () => {
    expect(downPaymentIsAdjustable(0, MIN_DOWN_PAYMENT_RANGE_CENTS - 1)).toBe(false);
    expect(downPaymentIsAdjustable(0, MIN_DOWN_PAYMENT_RANGE_CENTS)).toBe(true);
    expect(downPaymentIsAdjustable(0, 359_000)).toBe(true);
  });

  it('measures the range from a required minimum', () => {
    expect(downPaymentIsAdjustable(100_000, 102_000)).toBe(false);
    expect(downPaymentIsAdjustable(100_000, 200_000)).toBe(true);
  });

  it('rejects fractions and negatives', () => {
    expect(() => downPaymentIsAdjustable(-1, 100)).toThrow(RangeError);
    expect(() => downPaymentIsAdjustable(0, 1.5)).toThrow(RangeError);
  });
});
