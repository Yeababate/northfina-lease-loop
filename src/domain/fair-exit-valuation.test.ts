import { beforeAll, describe, expect, it } from 'vitest';
import { loadResidualCurves } from '@/data/load';
import type { ResidualCurves } from '@/data/schemas';
import { valuedState, valueReturnedItems, type ReturnedItem } from './fair-exit-valuation';

let curves: ResidualCurves;
beforeAll(async () => {
  curves = await loadResidualCurves();
});
const bike: ReturnedItem = {
  assetId: 'ebike-003',
  category: 'e_bike',
  modelYear: 2026,
  recordedCondition: 'new',
  usage: { unit: 'km', value: 0 },
  inspection: null,
  firstLeaseStartOn: '2026-11-05',
  firstLeaseListPriceCents: 389_000,
};

describe('returned-item valuation for fair-exit-v2', () => {
  it('values Aino’s bike on the exit date, assumed good before inspection', () => {
    // 7 months old: curve 82 % → 70 % between 6 and 12 months = 80 %; good × 0.85; 0 km.
    expect(valueReturnedItems([bike], '2027-06-05', curves)).toEqual({
      ok: true,
      marketValueCents: 264_520,
      items: [
        {
          assetId: 'ebike-003',
          basis: 'assumed',
          condition: 'good',
          usageUnit: 'km',
          usageValue: 0,
          ageMonths: 7,
          marketValueCents: 264_520,
        },
      ],
    });
  });

  it('uses an inspection when there is one, and never upgrades a worse recorded condition', () => {
    expect(
      valuedState({ ...bike, inspection: { condition: 'like_new', usageValue: 1_200 } })
    ).toEqual({ basis: 'inspected', condition: 'like_new', usageValue: 1_200 });
    expect(valuedState({ ...bike, recordedCondition: 'fair' })).toMatchObject({
      basis: 'assumed',
      condition: 'fair',
    });
    expect(valuedState({ ...bike, recordedCondition: 'good' }).condition).toBe('good');
  });

  it('adds up every item of a bundle', () => {
    const result = valueReturnedItems(
      [bike, { ...bike, assetId: 'ebike-004' }],
      '2027-06-05',
      curves
    );
    expect(result).toMatchObject({ ok: true, marketValueCents: 529_040 });
  });

  it('cannot value nothing or an item with the wrong usage unit', () => {
    expect(valueReturnedItems([], '2027-06-05', curves)).toEqual({
      ok: false,
      reason: 'market_value_unavailable',
    });
    expect(
      valueReturnedItems(
        [{ ...bike, usage: { unit: 'engine_hours', value: 0 } }],
        '2027-06-05',
        curves
      )
    ).toMatchObject({ ok: false });
  });
});
