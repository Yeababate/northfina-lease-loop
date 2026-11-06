import { beforeAll, expect, it } from 'vitest';
import { loadCoefficientTable, loadRefurbishmentCosts, loadSecondLifeDemand } from '@/data/load';
import { rankWaitingList, type WaitingEntry } from './matchmaking';
import { decideRefurbishment } from './refurbish-decision';

let table: Awaited<ReturnType<typeof loadCoefficientTable>>;
let costs: Awaited<ReturnType<typeof loadRefurbishmentCosts>>;
let waiting: WaitingEntry[];
beforeAll(async () => {
  [table, costs, waiting] = await Promise.all([
    loadCoefficientTable(),
    loadRefurbishmentCosts(),
    loadSecondLifeDemand().then((entries) =>
      entries.map((entry) => ({ ...entry, status: 'waiting' as const }))
    ),
  ]);
});

it('breaks identical laptop offers by the recorded sign-up date', () => {
  const result = decideRefurbishment(
    {
      category: 'laptop',
      condition: 'good',
      usageUnit: 'battery_cycles',
      usageValue: 320,
      hoursSinceService: null,
    },
    { ...costs, laptop: { ...costs.laptop, fixed: [] } }, // The wipe has already been recorded.
    () => 60_000
  );
  const duplicates = waiting.filter((entry) => ['wait-06', 'wait-14'].includes(entry.id)).reverse();
  const { ranked } = rankWaitingList(
    { category: 'laptop', readyOn: '2026-11-05' },
    result.options,
    duplicates,
    '2026-11-05',
    table,
    25.5
  );
  expect(ranked.map(({ entry, rankReason }) => [entry.id, rankReason])).toEqual([
    ['wait-06', 'earlier_sign_up'],
    ['wait-14', 'earlier_sign_up'],
  ]);
  expect(ranked[0]).toMatchObject({ monthlyNetCents: 2_198, monthlyGrossCents: 2_758 });
});

it('prioritizes a fair offer when it saves work and both borrowers have the same deadline', () => {
  const result = decideRefurbishment(
    {
      category: 'e_bike',
      condition: 'fair',
      usageUnit: 'km',
      usageValue: 16_000,
      hoursSinceService: null,
    },
    costs,
    ({ condition, usageValue }) =>
      usageValue > 0 ? 80_000 : condition === 'fair' ? 130_000 : 140_000,
    'fair'
  );
  const couriers = waiting.filter((entry) => ['wait-02', 'wait-13'].includes(entry.id));
  const { ranked } = rankWaitingList(
    { category: 'e_bike', readyOn: '2026-11-05' },
    result.options,
    couriers,
    '2026-11-05',
    table,
    25.5
  );
  expect(ranked[0]).toMatchObject({
    entry: { id: 'wait-02' },
    option: { id: 'as_is' },
    rankReason: 'less_refurbishment',
  });
  expect(ranked[1]).toMatchObject({ entry: { id: 'wait-13' }, option: { id: 'to_good' } });
});
