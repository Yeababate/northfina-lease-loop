import { beforeAll, expect, it } from 'vitest';
import { loadCoefficientTable } from '@/data/load';
import {
  dealerDiscountInputSchema,
  dealerDiscountSetting,
  discountRevisionKey,
  downPaymentAtStep,
} from './dealer-discount';
import { monthlyDiscount, type RentalDiscountRule } from './discounts';
import { quoteLease } from './pricing';

const terms = [12, 24, 36, 48];
const rule: RentalDiscountRule = {
  id: 'saved-aino-offer',
  revision: 8,
  name: 'Existing label',
  minTermMonths: 36,
  maxTermMonths: 48,
  discountBps: 1000,
  enabled: true,
};
let table: Awaited<ReturnType<typeof loadCoefficientTable>>;
beforeAll(async () => {
  table = await loadCoefficientTable();
});

it('represents the saved 10% 36–48 offer as one threshold without changing the record', () => {
  const original = structuredClone(rule);
  expect(dealerDiscountSetting([rule], terms)).toMatchObject({
    mode: 'simple',
    ruleId: rule.id,
    discountBps: 1000,
    minTermMonths: 36,
    enabled: true,
  });
  expect(dealerDiscountSetting([], terms).mode).toBe('empty');
  expect(rule).toEqual(original);
  expect(dealerDiscountSetting([{ ...rule, enabled: false }], terms)).toMatchObject({
    mode: 'simple',
    enabled: false,
  });
});
it('requires explicit replacement for multiple or bounded legacy offers and ignores archived history', () => {
  expect(dealerDiscountSetting([{ ...rule, maxTermMonths: 36 }], terms).mode).toBe('legacy');
  expect(
    dealerDiscountSetting([rule, { ...rule, id: 'second', minTermMonths: 24 }], terms).mode
  ).toBe('legacy');
  expect(dealerDiscountSetting([{ ...rule, minTermMonths: 35 }], terms).mode).toBe('legacy');
  expect(dealerDiscountSetting([rule, { ...rule, id: 'old', archived: true }], terms).mode).toBe(
    'simple'
  );
  expect(dealerDiscountSetting([], []).minTermMonths).toBe(36);
});
it('locks the full rule revision set independent of ordering', () => {
  expect(
    discountRevisionKey([
      { id: 'a', revision: 1 },
      { id: 'b', revision: 2 },
    ])
  ).toBe(
    discountRevisionKey([
      { id: 'b', revision: 2 },
      { id: 'a', revision: 1 },
    ])
  );
  expect(discountRevisionKey([rule])).not.toBe(discountRevisionKey([{ ...rule, revision: 9 }]));
  expect(
    dealerDiscountInputSchema.safeParse({
      minTermMonths: 36,
      discountBps: 10001,
      enabled: true,
      expectedRules: [],
    }).success
  ).toBe(false);
});
it('uses current slider term 24/36/48 rather than an older URL term and rounds €7.18 correctly', () => {
  for (const [currentTerm, discountBps] of [
    [24, 0],
    [36, 1000],
    [48, 1000],
  ]) {
    const result = quoteLease(
      table,
      {
        listPriceCents: 166950,
        downPaymentCents: 136950,
        termMonths: currentTerm!,
        vatRatePercent: 25.5,
      },
      [rule]
    );
    expect(result).toMatchObject({ ok: true, quote: { discountBps } });
  }
  expect(monthlyDiscount(718, 48, [rule])).toMatchObject({
    monthlyDiscountCents: 72,
    monthlyNetCents: 646,
  });
  const result = quoteLease(
    table,
    { listPriceCents: 166950, downPaymentCents: 136950, termMonths: 48, vatRatePercent: 25.5 },
    [rule]
  );
  expect(result).toMatchObject({
    ok: true,
    quote: {
      originalMonthlyNetCents: 718,
      monthlyDiscountCents: 72,
      monthlyNetCents: 646,
      monthlyVatCents: 165,
      monthlyGrossCents: 811,
      buyoutCents: 2400,
    },
  });
});
it('keeps euro steps but reaches the exact cents at the down-payment endpoint', () => {
  expect(downPaymentAtStep(0, 136950, 1369)).toBe(136900);
  expect(downPaymentAtStep(0, 136950, 1370)).toBe(136950);
  expect(downPaymentAtStep(5000, 5000, 0)).toBe(5000);
  for (const input of [
    [-1, 10, 0],
    [20, 10, 0],
    [0, 10, -1],
    [0, 10, 0.5],
  ])
    expect(() => downPaymentAtStep(input[0]!, input[1]!, input[2]!)).toThrow();
});
