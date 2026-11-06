import { beforeAll, expect, it } from 'vitest';
import { loadCoefficientTable, loadResidualCurves } from '@/data/load';
import { marketAgeMonths, marketValueCents, nextLifeListPriceCents } from './market-value';

let curves: Awaited<ReturnType<typeof loadResidualCurves>>;
let table: Awaited<ReturnType<typeof loadCoefficientTable>>;
beforeAll(async () => {
  [curves, table] = await Promise.all([loadResidualCurves(), loadCoefficientTable()]);
});

const bike = {
  category: 'e_bike',
  condition: 'good',
  ageMonths: 9,
  firstLeaseListPriceCents: 389_000,
  usage: { unit: 'km', value: 18_400 },
} as const;

it('counts full months from the first lease or July of the model year', () => {
  expect(marketAgeMonths('2025-01-10', 2022, '2026-03-09')).toBe(13);
  expect(marketAgeMonths('2025-01-10', 2022, '2026-03-10')).toBe(14);
  expect(marketAgeMonths(null, 2022, '2026-11-05')).toBe(52);
  expect(marketAgeMonths(null, 2026, '2026-06-01')).toBe(0);
});

it('interpolates and applies condition and capped usage before rounding to cents', () => {
  expect(marketValueCents(bike, curves)).toMatchObject({
    priceCents: 201_035,
    breakdown: {
      curvePercent: 76,
      conditionMultiplier: 0.85,
      usagePercent: -20,
      rounding: 'half_up',
    },
  });
  expect(marketValueCents({ ...bike, ageMonths: 86 }, curves)).toMatchObject({
    priceCents: 66_130,
    breakdown: { curvePercent: 25 },
  });
});

it('holds the last curve point and reports a price below the finance floor', () => {
  expect(
    nextLifeListPriceCents(
      { ...bike, firstLeaseListPriceCents: 150_000, ageMonths: 90 },
      curves,
      table
    )
  ).toMatchObject({ ok: false, reason: 'below_minimum', priceCents: 25_500 });
});

it('rejects mismatched usage units before offering a next-life price', () => {
  const wrongUnit = { ...bike, usage: { unit: 'engine_hours' as const, value: 100 } };
  expect(marketValueCents(wrongUnit, curves)).toEqual({ ok: false, reason: 'usage_unit_mismatch' });
  expect(nextLifeListPriceCents(wrongUnit, curves, table)).toEqual({
    ok: false,
    reason: 'usage_unit_mismatch',
  });
});

it('uses the first curve point for a new item and accepts the finance floor itself', () => {
  const fresh = {
    ...bike,
    ageMonths: 0,
    condition: 'new' as const,
    usage: { unit: 'km' as const, value: 0 },
  };
  expect(marketValueCents(fresh, curves)).toMatchObject({
    ok: true,
    priceCents: 389_000,
    breakdown: { curvePercent: 100 },
  });
  const floor = Math.min(...table.bands.map((band) => band.min_financed_cents));
  expect(
    nextLifeListPriceCents({ ...fresh, firstLeaseListPriceCents: floor }, curves, table)
  ).toMatchObject({ ok: true, priceCents: floor });
});
