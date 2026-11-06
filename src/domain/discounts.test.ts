import { beforeAll, expect, it } from 'vitest';
import { loadCoefficientTable, loadPriceLists } from '@/data/load';
import { discountRuleInputSchema, monthlyDiscount, type RentalDiscountRule } from './discounts';
import { quoteLease } from './pricing';
import { priceContract } from './contract-pricing';

const rule: RentalDiscountRule = {
  id: 'rule-a',
  revision: 1,
  name: 'Long lease',
  minTermMonths: 24,
  maxTermMonths: 36,
  discountBps: 1000,
  enabled: true,
};
let table: Awaited<ReturnType<typeof loadCoefficientTable>>;
let lists: Awaited<ReturnType<typeof loadPriceLists>>;
beforeAll(async () => {
  [table, lists] = await Promise.all([loadCoefficientTable(), loadPriceLists()]);
});

it.each([
  [12, 0],
  [23, 0],
  [24, 100],
  [36, 100],
  [37, 0],
  [48, 0],
])('uses inclusive duration boundaries: %s', (term, cents) => {
  expect(monthlyDiscount(1000, term, [rule]).monthlyDiscountCents).toBe(cents);
});
it('never stacks; takes the best discount and a stable id tie-break regardless of order', () => {
  const better = { ...rule, id: 'rule-b', discountBps: 2000 };
  const tie = { ...better, id: 'rule-c' };
  const disabled = { ...rule, id: 'rule-0', discountBps: 10000, enabled: false };
  expect(monthlyDiscount(1000, 36, [rule, tie, disabled, better])).toEqual(
    monthlyDiscount(1000, 36, [better, disabled, tie, rule])
  );
  expect(monthlyDiscount(1000, 36, [tie, better])).toMatchObject({
    discountRuleId: 'rule-b',
    monthlyNetCents: 800,
    monthlyDiscountCents: 200,
  });
});
it('rounds the discount half up once and subtracts it, including full and sub-cent discounts', () => {
  expect(monthlyDiscount(101, 24, [{ ...rule, discountBps: 5000 }])).toMatchObject({
    originalMonthlyNetCents: 101,
    monthlyDiscountCents: 51,
    monthlyNetCents: 50,
  });
  expect(monthlyDiscount(1, 24, [{ ...rule, discountBps: 1 }])).toMatchObject({
    monthlyNetCents: 1,
    monthlyDiscountCents: 0,
    discountRuleId: rule.id,
  });
  expect(monthlyDiscount(101, 24, [{ ...rule, discountBps: 10000 }])).toMatchObject({
    monthlyNetCents: 0,
    monthlyDiscountCents: 101,
  });
  expect(monthlyDiscount(0, 24, [])).toMatchObject({ monthlyNetCents: 0, discountRuleId: null });
});
it('validates supported duration ranges, names, integer basis points and discount limits', () => {
  const { id: _id, revision: _revision, ...input } = rule;
  for (const patch of [
    { minTermMonths: 37, maxTermMonths: 36 },
    { minTermMonths: 25, maxTermMonths: 35 },
    { minTermMonths: 0 },
    { maxTermMonths: 49 },
    { maxTermMonths: 36.5 },
    { discountBps: 0 },
    { discountBps: -1 },
    { discountBps: 10001 },
    { discountBps: 1.5 },
    { name: ' ' },
  ])
    expect(discountRuleInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  for (const discountBps of [1, 10000])
    expect(discountRuleInputSchema.safeParse({ ...input, discountBps }).success).toBe(true);
});
it('keeps preview and contract identical, applies VAT after discount, and leaves buyout/down payment unchanged', () => {
  const input = {
    listPriceCents: 389000,
    downPaymentCents: 10000,
    termMonths: 36,
    vatRatePercent: 25.5,
  };
  const base = quoteLease(table, input);
  const preview = quoteLease(table, input, [rule]);
  const signed = priceContract(
    lists,
    table,
    { assetId: 'ebike-003', termMonths: 36, downPaymentCents: 10000 },
    '2026-11-05',
    [rule]
  );
  if (!base.ok || !preview.ok || !signed.ok) throw new Error('Quote failed');
  expect(signed.price.monthlyNetCents).toBe(preview.quote.monthlyNetCents);
  expect(signed.price.buyoutNetCents).toBe(preview.quote.buyoutCents);
  expect(preview.quote.buyoutCents).toBe(base.quote.buyoutCents);
  expect(preview.quote.financedCents).toBe(base.quote.financedCents);
  expect(preview.quote.totalNetCents).toBe(10000 + preview.quote.monthlyNetCents * 36);
  expect(preview.quote.monthlyNetCents + preview.quote.monthlyDiscountCents).toBe(
    base.quote.monthlyNetCents
  );
  expect(preview.quote.monthlyGrossCents).toBe(
    preview.quote.monthlyNetCents + preview.quote.monthlyVatCents
  );
  expect(signed.price).toMatchObject({
    discountRuleId: rule.id,
    discountRuleRevision: 1,
    discountBps: 1000,
  });
});

it('rejects invalid cent amounts and out-of-range internal percentages', () => {
  for (const cents of [-1, 0.5, NaN]) expect(() => monthlyDiscount(cents, 36, [rule])).toThrow();
  for (const discountBps of [0, 10001, 1.5])
    expect(() => monthlyDiscount(1000, 36, [{ ...rule, discountBps }])).toThrow();
});
