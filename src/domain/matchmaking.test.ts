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

function options() {
  return decideRefurbishment(
    {
      category: 'laptop',
      condition: 'good',
      usageUnit: 'battery_cycles',
      usageValue: 100,
      hoursSinceService: null,
    },
    { ...costs, laptop: { ...costs.laptop, fixed: [] } },
    () => 60_000
  ).options;
}
function entry(overrides: Partial<WaitingEntry> = {}): WaitingEntry {
  return {
    ...waiting.find((row) => row.id === 'wait-06')!,
    id: 'a',
    needed_by: '2026-12-01',
    signed_up_on: '2026-10-01',
    max_monthly_net_rent_cents: 100_000,
    ...overrides,
  };
}
function rank(entries: WaitingEntry[], offered = options()) {
  return rankWaitingList(
    { category: 'laptop', readyOn: '2026-11-06' },
    offered,
    entries,
    '2026-11-05',
    table,
    25.5
  );
}

it('explains deadline, readiness and stable-id ordering independent of input order', () => {
  expect(rank([entry({ needed_by: '2026-11-04' })]).rejected).toEqual([
    { entryId: 'a', reason: 'deadline_passed' },
  ]);
  expect(rank([entry({ needed_by: '2026-11-05' })]).rejected).toEqual([
    { entryId: 'a', reason: 'not_ready_in_time' },
  ]);
  expect(rank([entry()]).ranked[0]?.rankReason).toBe('only_eligible');
  const result = rank([entry({ id: 'b' }), entry()]);
  expect(result.ranked.map(({ entry, rankReason }) => [entry.id, rankReason])).toEqual([
    ['a', 'entry_id'],
    ['b', 'entry_id'],
  ]);
});

it('reports unfinanceable offers and keeps over-budget as the more actionable rejection', () => {
  const valid = options()[0]!;
  const tiny = { ...valid, marketValueCents: 1 };
  expect(rank([entry()], [tiny]).rejected).toEqual([{ entryId: 'a', reason: 'unfinanceable' }]);
  expect(rank([entry({ max_monthly_net_rent_cents: 1 })], [valid, tiny]).rejected).toEqual([
    { entryId: 'a', reason: 'over_budget' },
  ]);
  const missingValue = { ...valid, marketValueCents: null };
  expect(rank([entry()], [tiny, missingValue, missingValue]).rejected[0]?.reason).toBe(
    'unfinanceable'
  );
});
