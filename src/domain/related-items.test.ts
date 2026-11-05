import { describe, expect, it } from 'vitest';
import { loadCoefficientTable, loadPriceLists } from '@/data/load';
import { relatedItemRulesSchema, type Asset, type RelatedItemRules } from '@/data/schemas';
import {
  monthlyRentBasis,
  priceDifferenceBps,
  priceSimilarityScore,
  rankRelatedItems,
  type RelatedCandidate,
} from './related-items';

const rules: RelatedItemRules = relatedItemRulesSchema.parse({
  version: 1,
  note: 'test',
  weights: { category: 70, price: 25, condition: 5 },
  category_affinity: {
    e_bike: { e_bike: 100, laptop: 30 },
    laptop: { laptop: 100, e_bike: 30 },
  },
  zero_affinity_fallback: 0,
  price: {
    basis: 'monthly_net_rent_same_term_no_down_payment',
    full_score_within_bps: 1000,
    zero_score_from_bps: 10000,
  },
  condition_score: { new: 100, like_new: 90, good: 70, fair: 40, poor: 10 },
  limit: 4,
});

function asset(id: string, overrides: Partial<Asset> = {}): Asset {
  return {
    id,
    category: 'e_bike',
    make: 'Make',
    model: id,
    model_year: 2026,
    serial_number: `SN-${id}`,
    condition: 'new',
    usage: { unit: 'km', value: 0 },
    previous_lives: 0,
    status: 'available',
    ...overrides,
  };
}

const viewed = { asset: asset('ebike-a', { condition: 'good' }), monthlyNetCents: 10000 };
const candidate = (
  id: string,
  monthlyNetCents: number | null,
  overrides: Partial<Asset> = {}
): RelatedCandidate => ({ asset: asset(id, overrides), monthlyNetCents });

describe('rankRelatedItems', () => {
  it('orders by score, then by ascending asset id for equal scores', () => {
    const result = rankRelatedItems(
      viewed,
      [
        candidate('ebike-z', 10000),
        candidate('ebike-b', 10000),
        candidate('laptop-a', 10000, { category: 'laptop' }),
        candidate('ebike-far', 30000),
      ],
      rules
    );
    expect(result.items.map((item) => item.asset.id)).toEqual([
      'ebike-b',
      'ebike-z',
      'ebike-far',
      'laptop-a',
    ]);
    // 100 × 70 + 100 × 25 + 100 × 5
    expect(result.items[0]!.score).toBe(10000);
  });

  it('never returns the viewed item, duplicates, unavailable or unpriced items', () => {
    const result = rankRelatedItems(
      viewed,
      [
        candidate('ebike-a', 10000),
        candidate('ebike-b', 10000),
        candidate('ebike-b', 10000),
        candidate('ebike-r', 10000, { status: 'reserved' }),
        candidate('ebike-ret', 10000, { status: 'returned' }),
        candidate('ebike-np', null),
      ],
      rules
    );
    expect(result.items.map((item) => item.asset.id)).toEqual(['ebike-b']);
    expect(result.excluded).toEqual([
      { assetId: 'ebike-a', reason: 'viewed_item' },
      { assetId: 'ebike-b', reason: 'duplicate' },
      { assetId: 'ebike-r', reason: 'not_available' },
      { assetId: 'ebike-ret', reason: 'not_available' },
      { assetId: 'ebike-np', reason: 'cannot_be_priced' },
    ]);
  });

  it('leaves out zero-affinity categories unless a fallback is configured', () => {
    const farm = candidate('farm-1', 10000, { category: 'farm_machine' });
    expect(rankRelatedItems(viewed, [farm], rules).items).toEqual([]);
    const withFallback = { ...rules, zero_affinity_fallback: 10 };
    const items = rankRelatedItems(viewed, [farm], withFallback).items;
    expect(items.map((item) => item.asset.id)).toEqual(['farm-1']);
    expect(items[0]!.reasons).toContain('complementary_category');
  });

  it('returns an empty list when nothing qualifies', () => {
    expect(rankRelatedItems(viewed, [], rules)).toEqual({ items: [], excluded: [] });
  });

  it('applies the result limit after sorting', () => {
    const many = ['e', 'd', 'c', 'b', 'a', 'f'].map((id) => candidate(`ebike-${id}x`, 10000));
    const items = rankRelatedItems(viewed, many, rules).items;
    expect(items.map((item) => item.asset.id)).toEqual([
      'ebike-ax',
      'ebike-bx',
      'ebike-cx',
      'ebike-dx',
    ]);
  });

  it('treats the budget as a hard limit and explains it', () => {
    const result = rankRelatedItems(
      { ...viewed, budgetMonthlyNetCents: 12000 },
      [candidate('ebike-b', 12000), candidate('ebike-c', 12001)],
      rules
    );
    expect(result.items.map((item) => item.asset.id)).toEqual(['ebike-b']);
    expect(result.items[0]!.reasons).toContain('within_budget');
    expect(result.excluded).toEqual([{ assetId: 'ebike-c', reason: 'over_budget' }]);
  });

  it('gives explanation codes only for facts that hold', () => {
    const items = rankRelatedItems(
      viewed,
      [
        candidate('ebike-b', 10500, { condition: 'like_new' }),
        candidate('ebike-c', 20000, { condition: 'fair' }),
      ],
      rules
    ).items;
    expect(items[0]!.reasons).toEqual([
      'same_category',
      'similar_monthly_price',
      'same_or_better_condition',
    ]);
    expect(items[1]!.reasons).toEqual(['same_category']);
  });

  it('reorders when the configured weights change', () => {
    const pool = [
      // Same category, rent far away.
      candidate('ebike-b', 25000),
      // Complementary category, identical rent.
      candidate('laptop-a', 10000, { category: 'laptop' }),
    ];
    const byCategory = rankRelatedItems(viewed, pool, rules).items.map((i) => i.asset.id);
    expect(byCategory).toEqual(['ebike-b', 'laptop-a']);
    const priceHeavy = { ...rules, weights: { category: 20, price: 75, condition: 5 } };
    const byPrice = rankRelatedItems(viewed, pool, priceHeavy).items.map((i) => i.asset.id);
    expect(byPrice).toEqual(['laptop-a', 'ebike-b']);
  });

  it('rejects a viewed item without a positive rent', () => {
    expect(() => rankRelatedItems({ ...viewed, monthlyNetCents: 0 }, [], rules)).toThrow(
      RangeError
    );
  });
});

describe('price similarity', () => {
  it('measures difference as basis points of the viewed rent, rounded half up', () => {
    expect(priceDifferenceBps(10000, 10000)).toBe(0);
    expect(priceDifferenceBps(10000, 9000)).toBe(1000);
    expect(priceDifferenceBps(3, 4)).toBe(3333);
  });

  it('scores 100 within the full band, 0 from the zero point and linearly between', () => {
    expect(priceSimilarityScore(rules, 0)).toBe(100);
    expect(priceSimilarityScore(rules, 1000)).toBe(100);
    expect(priceSimilarityScore(rules, 1001)).toBe(99);
    expect(priceSimilarityScore(rules, 5500)).toBe(50);
    expect(priceSimilarityScore(rules, 10000)).toBe(0);
    expect(priceSimilarityScore(rules, 50000)).toBe(0);
  });
});

describe('related-item rules schema', () => {
  it('rejects weights that do not add up to 100 and inverted price thresholds', () => {
    expect(
      relatedItemRulesSchema.safeParse({
        ...rules,
        weights: { category: 70, price: 25, condition: 0 },
      }).success
    ).toBe(false);
    expect(
      relatedItemRulesSchema.safeParse({
        ...rules,
        price: { ...rules.price, full_score_within_bps: 20000 },
      }).success
    ).toBe(false);
  });
});

describe('monthlyRentBasis', () => {
  it('uses the shared quote: monthly net rent, same term, no down payment', async () => {
    const [lists, table] = await Promise.all([loadPriceLists(), loadCoefficientTable()]);
    // The data pack worked example: ebike-003, 36 months, 5 Nov 2026 → 10730 cents.
    expect(monthlyRentBasis(lists, table, 'ebike-003', 36, '2026-11-05')).toBe(10730);
    // Too cheap to finance (below the smallest band) and unknown items have no basis.
    expect(monthlyRentBasis(lists, table, 'ebike-010', 36, '2026-11-05')).toBeNull();
    expect(monthlyRentBasis(lists, table, 'nope', 36, '2026-11-05')).toBeNull();
    expect(monthlyRentBasis(lists, table, 'ebike-003', 18, '2026-11-05')).toBeNull();
  });
});
