import { beforeAll, describe, expect, it } from 'vitest';
import { loadResidualCurves } from '@/data/load';
import type { ResidualCurves } from '@/data/schemas';
import { ageInMonths, curveAt, marketValue } from './market-value';

let curves: ResidualCurves;
beforeAll(async () => {
  curves = await loadResidualCurves();
});

describe('ageInMonths', () => {
  it('counts whole months from 1 January of the model year', () => {
    expect(ageInMonths(2023, '2026-11-06')).toBe(46);
    expect(ageInMonths(2026, '2026-01-31')).toBe(0);
    expect(ageInMonths(2027, '2026-11-06')).toBe(0); // never negative
  });
});

describe('curveAt', () => {
  it('interpolates linearly between points and holds the ends', () => {
    const points = curves.curves.e_bike;
    expect(curveAt(points, 0)).toBe(1_000_000);
    expect(curveAt(points, 46)).toBe(325_000); // 40 % at 36, 31 % at 48 → 32.5 %
    expect(curveAt(points, 600)).toBe(250_000); // held at the last point (25 %)
  });
});

describe('marketValue', () => {
  it('values a refurbished ebike-007 (good, battery replaced) at 46 months', () => {
    // 5 490.00 × 32.5 % × 0.85 × no usage loss = 1 516.6125 → 1 516.61
    expect(
      marketValue(
        {
          category: 'e_bike',
          condition: 'good',
          usageValue: 0,
          listPriceCents: 549_000,
          ageMonths: 46,
        },
        curves
      ).valueCents
    ).toBe(151_661);
  });

  it('lowers the value for wear, step by step', () => {
    // ebike-008: 1 799.00 × 26 % × 0.85 × (1 − 9 × 2 %) = 326.0148… → 326.01
    const value = marketValue(
      {
        category: 'e_bike',
        condition: 'good',
        usageValue: 9800,
        listPriceCents: 179_900,
        ageMonths: 58,
      },
      curves
    );
    expect(value.usagePpm).toBe(820_000);
    expect(value.valueCents).toBe(32_601);
  });

  it('caps the usage loss at the maximum', () => {
    expect(
      marketValue(
        {
          category: 'e_bike',
          condition: 'good',
          usageValue: 90_000,
          listPriceCents: 100_000,
          ageMonths: 0,
        },
        curves
      ).usagePpm
    ).toBe(800_000); // −20 % at most
  });

  it('rejects fractions and negatives', () => {
    expect(() =>
      marketValue(
        { category: 'e_bike', condition: 'good', usageValue: 0, listPriceCents: 1.5, ageMonths: 0 },
        curves
      )
    ).toThrow(RangeError);
  });
});
