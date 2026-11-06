import { describe, expect, it } from 'vitest';
import { calculateEarlyBuyoutPrice, calculateEarlyCancellationFee } from './early-exit-price';

const input = { monthlyRentCents: 10730, remainingMonths: 29, elapsedMonths: 7 };

describe('replaceable early-exit prices', () => {
  it('calculates Aino after seven earned periods and separates buyout from cancellation', () => {
    expect(calculateEarlyCancellationFee(input)).toBe(155585);
    expect(calculateEarlyBuyoutPrice({ ...input, endOfTermBuyoutCents: 58350 })).toBe(369520);
  });

  it('rounds odd cent halves up once and accepts elapsed time for future policies', () => {
    expect(
      calculateEarlyCancellationFee({ ...input, monthlyRentCents: 101, remainingMonths: 1 })
    ).toBe(51);
    expect(calculateEarlyCancellationFee({ ...input, elapsedMonths: 0 })).toBe(155585);
  });

  it('reaches no cancellation fee and exactly the signed buyout at maturity', () => {
    const final = { ...input, remainingMonths: 0, elapsedMonths: 36 };
    expect(calculateEarlyCancellationFee(final)).toBe(0);
    expect(calculateEarlyBuyoutPrice({ ...final, endOfTermBuyoutCents: 58350 })).toBe(58350);
    expect(calculateEarlyCancellationFee({ ...input, monthlyRentCents: 0 })).toBe(0);
  });

  it.each(['monthlyRentCents', 'remainingMonths', 'elapsedMonths'] as const)(
    'rejects invalid %s rather than silently accepting fractional periods or cents',
    (key) => {
      for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => calculateEarlyCancellationFee({ ...input, [key]: value })).toThrow(RangeError);
      }
    }
  );

  it('rejects overflow and invalid final buyout without losing cents', () => {
    expect(() =>
      calculateEarlyCancellationFee({ ...input, monthlyRentCents: Number.MAX_SAFE_INTEGER })
    ).toThrow(RangeError);
    expect(() => calculateEarlyBuyoutPrice({ ...input, endOfTermBuyoutCents: -1 })).toThrow(
      RangeError
    );
    expect(() => calculateEarlyBuyoutPrice({ ...input, endOfTermBuyoutCents: 0.5 })).toThrow(
      RangeError
    );
    expect(() =>
      calculateEarlyBuyoutPrice({ ...input, endOfTermBuyoutCents: Number.MAX_SAFE_INTEGER })
    ).toThrow(RangeError);
  });
});
