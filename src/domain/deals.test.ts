import { describe, expect, it } from 'vitest';
import type { RentalDiscountRule } from './discounts';
import { bestDeal, dealTiers, percentText, termDiscounts } from './deals';

const terms = [12, 24, 36, 48];
const rule = (
  id: string,
  minTermMonths: number,
  maxTermMonths: number,
  discountBps: number,
  enabled = true
): RentalDiscountRule => ({
  id,
  revision: 1,
  name: id,
  minTermMonths,
  maxTermMonths,
  discountBps,
  enabled,
});

describe('termDiscounts', () => {
  it('uses the same winner as pricing: highest percentage, no stacking', () => {
    const rules = [rule('a', 24, 48, 1000), rule('b', 36, 48, 1500)];
    expect(termDiscounts(rules, terms)).toEqual([
      { termMonths: 12, discountBps: 0 },
      { termMonths: 24, discountBps: 1000 },
      { termMonths: 36, discountBps: 1500 },
      { termMonths: 48, discountBps: 1500 },
    ]);
  });

  it('ignores disabled rules', () => {
    expect(
      termDiscounts([rule('a', 12, 48, 1000, false)], terms).every((t) => t.discountBps === 0)
    ).toBe(true);
  });
});

describe('bestDeal', () => {
  it('is the largest discount and the shortest term that gets it', () => {
    expect(bestDeal([rule('a', 24, 48, 1000), rule('b', 36, 48, 1500)], terms)).toEqual({
      discountBps: 1500,
      fromTermMonths: 36,
    });
  });

  it('works whatever order the terms come in', () => {
    expect(bestDeal([rule('a', 24, 48, 1000)], [48, 12, 36, 24])).toEqual({
      discountBps: 1000,
      fromTermMonths: 24,
    });
  });

  it('is null without a discounted term', () => {
    expect(bestDeal([], terms)).toBeNull();
    expect(bestDeal([rule('a', 13, 23, 1000)], terms)).toBeNull();
  });
});

describe('dealTiers', () => {
  it('merges neighbouring terms with the same discount', () => {
    expect(dealTiers([rule('a', 24, 48, 1000), rule('b', 48, 48, 1500)], terms)).toEqual([
      { discountBps: 1000, fromTermMonths: 24, toTermMonths: 36 },
      { discountBps: 1500, fromTermMonths: 48, toTermMonths: null },
    ]);
  });

  it('marks a tier that runs to the longest term as open-ended', () => {
    expect(dealTiers([rule('a', 36, 48, 4000)], terms)).toEqual([
      { discountBps: 4000, fromTermMonths: 36, toTermMonths: null },
    ]);
  });

  it('keeps a closed range that stops before the longest term', () => {
    expect(dealTiers([rule('a', 12, 24, 500)], terms)).toEqual([
      { discountBps: 500, fromTermMonths: 12, toTermMonths: 24 },
    ]);
  });

  it('is empty without discounts', () => {
    expect(dealTiers([], terms)).toEqual([]);
  });
});

describe('percentText', () => {
  it('drops needless decimals and uses the language’s decimal sign', () => {
    expect(percentText(1000, 'en-GB')).toBe('10');
    expect(percentText(1050, 'en-GB')).toBe('10.5');
    expect(percentText(125, 'en-GB')).toBe('1.25');
    expect(percentText(125, 'fi-FI')).toBe('1,25');
    expect(percentText(5, 'en-GB')).toBe('0.05');
  });

  it('rejects fractions', () => {
    expect(() => percentText(10.5, 'en-GB')).toThrow(RangeError);
  });
});
