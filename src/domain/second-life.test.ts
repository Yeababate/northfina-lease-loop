import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadAssets,
  loadCoefficientTable,
  loadPriceLists,
  loadRefurbishmentCosts,
  loadResidualCurves,
  loadSecondLifeDemand,
} from '@/data/load';
import type { Asset, SecondLifeRequest } from '@/data/schemas';
import { planNextLife, planNextLives, type PlanContext, type ReturnedItem } from './second-life';

const today = '2026-11-06';
let ctx: Omit<PlanContext, 'taken'>;
let returned: ReturnedItem[];
let item: (id: string) => ReturnedItem;

beforeAll(async () => {
  const [assets, lists, table, rules, curves, waitingList] = await Promise.all([
    loadAssets(),
    loadPriceLists(),
    loadCoefficientTable(),
    loadRefurbishmentCosts(),
    loadResidualCurves(),
    loadSecondLifeDemand(),
  ]);
  ctx = { today, rules, curves, table, waitingList };
  const first = [...lists].sort((a, b) => a.valid_from.localeCompare(b.valid_from))[0]!;
  const toItem = (a: Asset): ReturnedItem => ({
    assetId: a.id,
    category: a.category,
    condition: a.condition,
    usageUnit: a.usage.unit,
    usageValue: a.usage.value,
    modelYear: a.model_year,
    listPriceCents: first.prices[a.id] ?? 0,
    hoursSinceService: null,
  });
  returned = assets.filter((a) => a.status === 'returned').map(toItem);
  item = (id) => toItem(assets.find((a) => a.id === id)!);
});

describe('scenario 9: ebike-007 came back fair with 18,400 km', () => {
  it('is refurbished, with every step costed', () => {
    const plan = planNextLife(item('ebike-007'), ctx);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.chosen.kind).toBe('refurbished');
    expect(plan.chosen.actions).toEqual([
      { id: 'battery_replacement', kind: 'fixed', costCents: 35_000 }, // over 15,000 km
      { id: 'safety_inspection', kind: 'fixed', costCents: 4_500 },
      { id: 'upgrade:fair->good', kind: 'upgrade', costCents: 12_000 },
    ]);
    expect(plan.chosen.costCents).toBe(51_500);
    expect(plan.chosen.conditionAfter).toBe('good');
    expect(plan.chosen.usageAfter).toBe(0); // the new battery resets the counter
    expect(plan.chosen.priceCents).toBe(151_661);
    // Leasing it as it is earns less, even after the cheaper work.
    expect(plan.alternative?.kind).toBe('as_is');
    expect(plan.chosen.valueCents!).toBeGreaterThan(plan.alternative!.valueCents!);
  });

  it('goes to wait-13, not wait-02: same deadline and budget, but the longer lease', () => {
    const plan = planNextLife(item('ebike-007'), ctx);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.chosen.match).toEqual({
      requestId: 'wait-13',
      who: 'Delivery courier, same budget as wait-02',
      termMonths: 24,
      monthlyNetCents: 5_556,
      neededBy: '2026-11-10',
    });
    expect(plan.chosen.notChosen).toContainEqual({
      requestId: 'wait-02',
      who: 'Delivery courier, accepts scratches',
      reason: 'lost_tie_break',
      rule: 'longer_term',
      monthlyNetCents: 8_496,
    });
  });
});

describe('scenario 10: ebike-008, already two lives', () => {
  it('needs only its safety check and gets a next-life price', () => {
    const plan = planNextLife(item('ebike-008'), ctx);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.chosen.actions).toEqual([
      { id: 'safety_inspection', kind: 'fixed', costCents: 4_500 },
    ]);
    expect(plan.alternative).toBeNull();
    expect(plan.chosen.priceCents).toBe(32_601);
  });
});

describe('planNextLife', () => {
  it('leases an item as it is when that earns more and someone accepts its condition', () => {
    // laptop-007 (fair): the non-profit accepts fair laptops on 36 months.
    const plan = planNextLife(item('laptop-007'), ctx);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.chosen.kind).toBe('as_is');
    expect(plan.chosen.match?.requestId).toBe('wait-08');
    expect(plan.listingMinimum).toBe('fair');
  });

  it('says when an item is worth less than the smallest lease', () => {
    expect(planNextLife(item('laptop-006'), ctx)).toMatchObject({
      ok: false,
      reason: 'too_cheap_to_lease',
      minimumCents: 30_000,
    });
  });

  it('waits for the service hours of a farm machine instead of guessing', () => {
    expect(planNextLife(item('farm-005'), ctx)).toMatchObject({
      ok: false,
      reason: 'service_hours_unknown',
    });
  });

  it('skips people whose deadline has passed', () => {
    const late = planNextLife(item('ebike-007'), { ...ctx, today: '2026-12-01' });
    if (!late.ok) throw new Error(late.reason);
    expect(late.chosen.notChosen).toContainEqual(
      expect.objectContaining({ requestId: 'wait-13', reason: 'deadline_passed' })
    );
  });

  it('refurbishes and lists for everyone when nobody on the list fits', () => {
    const plan = planNextLife(item('ebike-007'), { ...ctx, waitingList: [] });
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.chosen).toMatchObject({ kind: 'refurbished', match: null, valueCents: null });
    expect(plan.listingMinimum).toBe('good');
  });

  it('breaks a full tie by place on the list', () => {
    const twin = (id: string): SecondLifeRequest => ({
      id,
      category: 'e_bike',
      max_monthly_net_rent_cents: 9000,
      min_condition: 'good',
      preferred_term_months: 24,
      needed_by: '2026-11-10',
      who: id,
    });
    const plan = planNextLife(item('ebike-007'), {
      ...ctx,
      waitingList: [twin('first'), twin('second')],
    });
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.chosen.match?.requestId).toBe('first');
    expect(plan.chosen.notChosen[0]).toMatchObject({
      requestId: 'second',
      rule: 'earlier_on_list',
    });
  });
});

describe('planNextLives', () => {
  it('gives each person on the waiting list at most one item', () => {
    const matched = planNextLives(returned, ctx).flatMap((plan) =>
      plan.ok && plan.chosen.match ? [plan.chosen.match.requestId] : []
    );
    expect(new Set(matched).size).toBe(matched.length);
    expect(matched).toContain('wait-13');
  });
});
