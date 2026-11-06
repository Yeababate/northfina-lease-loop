import { beforeAll, expect, it } from 'vitest';
import {
  loadAssets,
  loadCoefficientTable,
  loadPriceLists,
  loadRefurbishmentCosts,
  loadResidualCurves,
  loadSecondLifeDemand,
} from '@/data/load';
import { marketAgeMonths, marketValueCents } from './market-value';
import { rankWaitingList } from './matchmaking';
import { decideRefurbishment, refurbishmentIsWorthIt } from './refurbish-decision';

let data: Awaited<ReturnType<typeof loadData>>;
async function loadData() {
  const [assets, table, lists, costs, curves, waiting] = await Promise.all([
    loadAssets(),
    loadCoefficientTable(),
    loadPriceLists(),
    loadRefurbishmentCosts(),
    loadResidualCurves(),
    loadSecondLifeDemand(),
  ]);
  return { assets, table, lists, costs, curves, waiting };
}
beforeAll(async () => {
  data = await loadData();
});

it.each([
  ['laptop-006', 'wait-06', 2500],
  ['ebike-008', 'wait-01', 4500],
] as const)('keeps %s matchable before its mandatory work is recorded', (id, entryId, cost) => {
  const asset = data.assets.find((row) => row.id === id)!;
  const decision = decideRefurbishment(
    {
      category: asset.category,
      condition: asset.condition,
      usageUnit: asset.usage.unit,
      usageValue: asset.usage.value,
      hoursSinceService: null,
    },
    data.costs,
    ({ condition, usageValue }) => {
      const value = marketValueCents(
        {
          ...asset,
          condition,
          usage: { ...asset.usage, value: usageValue },
          firstLeaseListPriceCents: data.lists[0]!.prices[id]!,
          ageMonths: marketAgeMonths(null, asset.model_year, '2026-11-06'),
        },
        data.curves
      );
      if (!value.ok) throw new Error(value.reason);
      return value.priceCents;
    }
  );
  expect(decision.recommendation).toEqual({ optionId: 'as_is', reason: 'mandatory_step_only' });
  expect(decision.options[0]).toMatchObject({ costCents: cost, netValueAddedCents: -cost });
  const result = rankWaitingList(
    { category: asset.category, readyOn: '2026-11-06' },
    decision.options,
    data.waiting
      .filter((row) => row.id === entryId)
      .map((row) => ({ ...row, status: 'waiting' as const })),
    '2026-11-06',
    data.table,
    25.5
  );
  expect(result.ranked[0]?.option.id).toBe('as_is');
});

it('rejects mandatory work costing more than the resulting item is worth', () => {
  const result = decideRefurbishment(
    {
      category: 'laptop',
      condition: 'good',
      usageUnit: 'battery_cycles',
      usageValue: 100,
      hoursSinceService: null,
    },
    data.costs,
    () => 1000
  );
  expect(result.recommendation.optionId).toBeNull();
  expect(result.options.every((option) => !refurbishmentIsWorthIt(option, result.options))).toBe(
    true
  );
});

it('requires an optional upgrade to beat the mandatory-work baseline', () => {
  const result = decideRefurbishment(
    {
      category: 'laptop',
      condition: 'good',
      usageUnit: 'battery_cycles',
      usageValue: 100,
      hoursSinceService: null,
    },
    data.costs,
    ({ condition }) => (condition === 'good' ? 90000 : 94000)
  );
  expect(result.recommendation.optionId).toBe('as_is');
  expect(refurbishmentIsWorthIt(result.options[1]!, result.options)).toBe(false);
});
