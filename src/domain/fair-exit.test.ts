import { describe, expect, it } from 'vitest';
import {
  FAIR_EXIT_METHOD,
  fairExitPrice,
  presentValueCents,
  sameBreakdown,
  type FairExitInput,
} from './fair-exit';

// Card 8: Aino, ebike-003, band B (7.9 %), 36 months, exit in month 7 → 29 rents remain.
const aino = {
  monthlyRentCents: 10_730,
  remainingMonths: 29,
  endOfTermBuyoutCents: 58_350,
  annualInterestPercent: 7.9,
  vatRatePercent: 26,
};
const valuation = {
  marketValueCents: 264_520,
  items: [
    {
      assetId: 'ebike-003',
      basis: 'assumed' as const,
      condition: 'good' as const,
      usageUnit: 'km' as const,
      usageValue: 0,
      ageMonths: 7,
      marketValueCents: 264_520,
    },
  ],
};

describe('fair-exit-v2 price', () => {
  it('prices Aino in month 7 step by step', () => {
    // Exact PV = 332 525.178… cents (checked independently with exact fractions) → 332 525.
    expect(FAIR_EXIT_METHOD).toBe('fair-exit-v2');
    expect(fairExitPrice({ ...aino, kind: 'buyout' })).toMatchObject({
      nominalRemainingRentCents: 311_170,
      discountCents: 36_995,
      buyoutValueCents: 332_525,
      marketValueCreditCents: 0,
      valuedItems: [],
      netCents: 332_525,
      vatCents: 86_457, // 332 525 × 26 % = 86 456.5 → half up
      grossCents: 418_982,
    });
    expect(fairExitPrice({ ...aino, kind: 'return', valuation })).toMatchObject({
      buyoutValueCents: 332_525,
      marketValueCents: 264_520,
      marketValueCreditCents: 264_520,
      netCents: 68_005,
      vatCents: 17_681,
      grossCents: 85_686,
    });
  });

  it('adds up line by line', () => {
    const b = fairExitPrice({ ...aino, kind: 'return', valuation });
    expect(
      b.nominalRemainingRentCents +
        b.endOfTermBuyoutCents -
        b.discountCents -
        b.marketValueCreditCents
    ).toBe(b.netCents);
    expect(b.netCents + b.vatCents).toBe(b.grossCents);
  });

  it('handles a zero rate, the last month and a zero-rent edge', () => {
    expect(presentValueCents({ ...aino, annualInterestPercent: 0 })).toBe(311_170 + 58_350);
    const last = fairExitPrice({ ...aino, remainingMonths: 0, kind: 'buyout' });
    expect(last).toMatchObject({
      nominalRemainingRentCents: 0,
      discountCents: 0,
      netCents: 58_350,
    });
    expect(presentValueCents({ ...aino, monthlyRentCents: 0, endOfTermBuyoutCents: 0 })).toBe(0);
    // One month left: that rent is due on the exit day (not discounted), the buyout a month later.
    expect(presentValueCents({ ...aino, remainingMonths: 1, annualInterestPercent: 12 })).toBe(
      10_730 + 57_772 // 58 350 / 1.01 = 57 772.27…
    );
  });

  it('credits at most the buyout value, so a return is never negative', () => {
    const rich = { ...valuation, marketValueCents: 10_000_000 };
    expect(fairExitPrice({ ...aino, kind: 'return', valuation: rich })).toMatchObject({
      marketValueCents: 10_000_000,
      marketValueCreditCents: 332_525,
      netCents: 0,
      vatCents: 0,
      grossCents: 0,
    });
  });

  it('floors an early buyout at the end-of-term buyout', () => {
    // Rent too small to cover interest on the buyout: PV(r) < B, so the floor applies.
    const odd = { ...aino, monthlyRentCents: 1, endOfTermBuyoutCents: 1_000_000 };
    expect(fairExitPrice({ ...odd, kind: 'buyout' }).netCents).toBe(1_000_000);
  });

  it('rejects invalid input', () => {
    for (const change of [
      { monthlyRentCents: -1 },
      { monthlyRentCents: 1.5 },
      { remainingMonths: -1 },
      { remainingMonths: 1201 },
      { endOfTermBuyoutCents: -1 },
      { annualInterestPercent: -1 },
      { annualInterestPercent: Number.NaN },
      { annualInterestPercent: 7.891 },
    ]) {
      expect(() => fairExitPrice({ ...aino, ...change, kind: 'buyout' })).toThrow(RangeError);
    }
    expect(() => fairExitPrice({ ...aino, kind: 'return' })).toThrow(RangeError);
    expect(() =>
      fairExitPrice({ ...aino, monthlyRentCents: Number.MAX_SAFE_INTEGER, kind: 'buyout' })
    ).toThrow(RangeError);
  });

  it('handles the longest supported term exactly', () => {
    expect(presentValueCents({ ...aino, remainingMonths: 1200 })).toBeGreaterThan(58_350);
  });
});

describe('fair-exit-v2 properties', () => {
  // Deterministic grid: rents, buyouts, rates and terms that cover all bands and terms.
  const rents = [0, 1, 999, 10_730, 52_317, 3_350_000];
  const buyoutShares = [0, 8, 15, 25, 40]; // % of 36 × rent, like the coefficient table
  const rates = [0, 5.5, 6.5, 7.9, 9.9, 24];
  const terms = [1, 12, 24, 36, 48];
  const marketValues = [0, 1, 50_000, 264_520, 99_999_999];

  const cases: (Omit<FairExitInput, 'kind'> & { term: number })[] = [];
  for (const rent of rents)
    for (const share of buyoutShares)
      for (const rate of rates)
        for (const term of terms)
          cases.push({
            monthlyRentCents: rent,
            remainingMonths: 0,
            endOfTermBuyoutCents: Math.floor((rent * 36 * share) / 100),
            annualInterestPercent: rate,
            vatRatePercent: 25.5,
            term,
          });

  it('a buyout price never rises as months pass, and is exactly the locked buyout at the end', () => {
    for (const { term, ...input } of cases) {
      let previous = Number.POSITIVE_INFINITY;
      for (let month = 1; month <= term; month++) {
        const price = fairExitPrice({ ...input, remainingMonths: term - month, kind: 'buyout' });
        expect(price.netCents).toBeLessThanOrEqual(previous);
        expect(price.netCents).toBeLessThanOrEqual(
          price.nominalRemainingRentCents + input.endOfTermBuyoutCents
        );
        previous = price.netCents;
      }
      expect(previous).toBe(input.endOfTermBuyoutCents);
    }
  });

  it('a return never costs more than a buyout and is never negative', () => {
    for (const { term, ...input } of cases) {
      for (const remainingMonths of [0, 1, Math.floor(term / 2), term - 1]) {
        const buyout = fairExitPrice({ ...input, remainingMonths, kind: 'buyout' });
        for (const marketValueCents of marketValues) {
          const ret = fairExitPrice({
            ...input,
            remainingMonths,
            kind: 'return',
            valuation: { marketValueCents, items: [] },
          });
          expect(ret.netCents).toBeGreaterThanOrEqual(0);
          expect(ret.vatCents).toBeGreaterThanOrEqual(0);
          expect(ret.discountCents).toBeGreaterThanOrEqual(0);
          expect(ret.netCents).toBeLessThanOrEqual(buyout.netCents);
          expect(ret.grossCents).toBeLessThanOrEqual(buyout.grossCents);
        }
      }
    }
  });
});

describe('sameBreakdown', () => {
  const a = fairExitPrice({ ...aino, kind: 'return', valuation });
  it('compares every line and every valued item', () => {
    expect(sameBreakdown(a, structuredClone(a))).toBe(true);
    expect(sameBreakdown(undefined, undefined)).toBe(true);
    expect(sameBreakdown(a, undefined)).toBe(false);
    expect(sameBreakdown(a, { ...a, vatRatePercent: 25.5 })).toBe(false);
    expect(sameBreakdown(a, { ...a, valuedItems: [] })).toBe(false);
    expect(
      sameBreakdown(a, { ...a, valuedItems: [{ ...a.valuedItems[0]!, condition: 'new' }] })
    ).toBe(false);
    expect(sameBreakdown(a, { ...a, extra: 1 } as typeof a)).toBe(false);
  });
});
