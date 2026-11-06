import { beforeAll, describe, expect, it } from 'vitest';
import { loadCoefficientTable, loadVatRates } from '@/data/load';
import type { CoefficientTable, VatRates } from '@/data/schemas';
import type { RentalDiscountRule } from './discounts';
import { breakdown, compareOptions } from './price-breakdown';
import { quoteLease } from './pricing';

let table: CoefficientTable;
let vat: VatRates;
beforeAll(async () => {
  [table, vat] = await Promise.all([loadCoefficientTable(), loadVatRates()]);
});

const quote = (listPriceCents: number, downPaymentCents: number, termMonths: number) => {
  const result = quoteLease(table, {
    listPriceCents,
    downPaymentCents,
    termMonths,
    vatRatePercent: 25.5,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.quote;
};

describe('breakdown', () => {
  it('matches the worked example (ebike-003, 36 months, no down payment) to the cent', () => {
    const b = breakdown(quote(389_000, 0, 36), vat, '2026-11-06');
    expect(b.quote.monthlyNetCents).toBe(10_730);
    expect(b.quote.buyoutCents).toBe(58_350);
    expect(b.monthlyFactorBps).toBe(276); // 0.027584 → 2.76 %
    expect(b.rentsNetCents).toBe(386_280); // 36 × 107.30
    expect(b.totalNetCents).toBe(386_280);
    expect(b.totalIfKeptNetCents).toBe(444_630); // + 583.50 buyout
    expect(b.costOfLeasingNetCents).toBe(55_630); // − 3 890.00 list price
  });

  it('uses the VAT on each invoice date across the 2027 change', () => {
    const b = breakdown(quote(389_000, 0, 36), vat, '2026-11-06');
    // November and December 2026 at 25.5 %, then 34 invoices at 26 %.
    expect(b.vatRates).toEqual([
      { ratePercent: 25.5, invoices: 2 },
      { ratePercent: 26, invoices: 34 },
    ]);
    expect(b.rentsGrossCents).toBe(2 * 13_466 + 34 * 13_520);
    expect(b.totalGrossCents).toBe(b.rentsGrossCents);
    // The buyout is taxed on the end date (2029, 26 %): 583.50 + 151.71.
    expect(b.totalIfKeptGrossCents).toBe(2 * 13_466 + 34 * 13_520 + 58_350 + 15_171);
  });

  it('adds the down payment, taxed on the start date', () => {
    const b = breakdown(quote(389_000, 50_000, 36), vat, '2026-11-06');
    expect(b.totalNetCents).toBe(50_000 + b.rentsNetCents);
    expect(b.totalGrossCents).toBe(50_000 + 12_750 + (b.rentsGrossCents ?? 0));
  });

  it('has no gross totals when a date has no VAT rate', () => {
    const b = breakdown(quote(389_000, 0, 36), { ...vat, rates: [] }, '2026-11-06');
    expect(b.rentsGrossCents).toBeNull();
    expect(b.totalGrossCents).toBeNull();
    expect(b.totalIfKeptGrossCents).toBeNull();
    expect(b.vatRates).toEqual([]);
    expect(b.totalNetCents).toBe(386_280);
  });

  it('puts the €1,999.99 and €2,000.00 laptops in different bands', () => {
    expect(breakdown(quote(199_999, 0, 36), vat, '2026-11-06').quote.band.band).toBe('A');
    expect(breakdown(quote(200_000, 0, 36), vat, '2026-11-06').quote.band.band).toBe('B');
  });
});

describe('compareOptions', () => {
  const input = () => ({ table, listPriceCents: 389_000, vat, startOn: '2026-11-06' });

  it('marks the lowest monthly and lowest total options, with the differences', () => {
    const result = compareOptions(input(), [
      { termMonths: 24, downPaymentCents: 0 },
      { termMonths: 36, downPaymentCents: 0 },
      { termMonths: 48, downPaymentCents: 0 },
    ]);
    const monthly = result.options.map((o) => (o.ok ? o.breakdown.quote.monthlyNetCents : 0));
    const totals = result.options.map((o) => (o.ok ? o.breakdown.totalNetCents : 0));
    expect(result.lowestMonthly).toBe(monthly.indexOf(Math.min(...monthly)));
    expect(result.lowestTotal).toBe(totals.indexOf(Math.min(...totals)));
    const [first] = result.options;
    expect(first?.ok && first.monthlyAboveLowestCents).toBe(monthly[0]! - Math.min(...monthly));
    expect(first?.ok && first.totalAboveLowestCents).toBe(totals[0]! - Math.min(...totals));
  });

  it('returns a reason for an option that cannot be leased, not a crash', () => {
    const result = compareOptions(input(), [
      { termMonths: 36, downPaymentCents: 0 },
      { termMonths: 36, downPaymentCents: 500_000 },
      { termMonths: 30, downPaymentCents: 0 },
    ]);
    expect(result.options[1]).toMatchObject({ ok: false, reason: 'down_payment_above_price' });
    expect(result.options[2]).toMatchObject({ ok: false, reason: 'unknown_term' });
    expect(result.lowestMonthly).toBe(0);
    expect(result.lowestTotal).toBe(0);
  });

  it('applies the long-term discount the same way as the price', () => {
    const rule: RentalDiscountRule = {
      id: 'r1',
      revision: 1,
      name: 'long',
      minTermMonths: 36,
      maxTermMonths: 48,
      discountBps: 1000,
      enabled: true,
    };
    const result = compareOptions({ ...input(), discountRules: [rule] }, [
      { termMonths: 24, downPaymentCents: 0 },
      { termMonths: 36, downPaymentCents: 0 },
    ]);
    const thirtySix = result.options[1];
    expect(thirtySix?.ok && thirtySix.breakdown.quote.monthlyNetCents).toBe(10_730 - 1_073);
  });

  it('is null when nothing can be priced', () => {
    const result = compareOptions({ ...input(), vat: { ...vat, rates: [] } }, [
      { termMonths: 24, downPaymentCents: 0 },
      { termMonths: 36, downPaymentCents: 0 },
    ]);
    expect(result.options.every((o) => !o.ok && o.reason === 'no_vat_rate')).toBe(true);
    expect(result.lowestMonthly).toBeNull();
    expect(result.lowestTotal).toBeNull();
  });

  it('accepts only 2–4 options', () => {
    expect(() => compareOptions(input(), [{ termMonths: 36, downPaymentCents: 0 }])).toThrow(
      RangeError
    );
    expect(() =>
      compareOptions(
        input(),
        [12, 24, 36, 48, 12].map((termMonths) => ({ termMonths, downPaymentCents: 0 }))
      )
    ).toThrow(RangeError);
  });
});
