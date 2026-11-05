import { beforeAll, describe, expect, it } from 'vitest';
import { loadCoefficientTable } from '@/data/load';
import type { CoefficientTable } from '@/data/schemas';
import {
  availableTerms,
  buyoutCents,
  maxDownPaymentCents,
  minDownPaymentCents,
  quoteLease,
} from './pricing';

let table: CoefficientTable;
beforeAll(async () => {
  table = await loadCoefficientTable();
});

const quote = (listPriceCents: number, downPaymentCents: number, termMonths: number) =>
  quoteLease(table, { listPriceCents, downPaymentCents, termMonths, vatRatePercent: 25.5 });

describe('quoteLease', () => {
  it('matches the worked example: ebike-003, 36 months, no down payment', () => {
    expect(quote(389_000, 0, 36)).toEqual({
      ok: true,
      quote: expect.objectContaining({
        financedCents: 389_000,
        band: expect.objectContaining({ band: 'B' }),
        factor: 0.027584,
        monthlyNetCents: 10_730, // 10 730.176 → 10 730
        monthlyVatCents: 2736,
        monthlyGrossCents: 13_466,
        buyoutCents: 58_350,
        totalNetCents: 386_280, // 36 × 10 730
      }),
    });
  });

  it('subtracts the down payment before picking the band', () => {
    // 2 100 € list − 200 € down = 1 900 € financed: band A, not band B.
    const result = quote(210_000, 20_000, 24);
    expect(result).toMatchObject({
      ok: true,
      quote: { financedCents: 190_000, band: { band: 'A' }, monthlyNetCents: 6961 },
    });
    // 190 000 × 0.036637 = 6961.03 → 6961; total includes the down payment.
    expect(result.ok && result.quote.totalNetCents).toBe(20_000 + 6961 * 24);
  });

  it('puts the band boundary on the financed amount: 1 999.99 € vs 2 000.00 €', () => {
    expect(quote(199_999, 0, 36)).toMatchObject({ ok: true, quote: { band: { band: 'A' } } });
    expect(quote(200_000, 0, 36)).toMatchObject({ ok: true, quote: { band: { band: 'B' } } });
  });

  it('uses the VAT rate it is given', () => {
    const at26 = quoteLease(table, {
      listPriceCents: 389_000,
      downPaymentCents: 0,
      termMonths: 36,
      vatRatePercent: 26,
    });
    expect(at26).toMatchObject({
      ok: true,
      quote: { monthlyNetCents: 10_730, monthlyVatCents: 2790, monthlyGrossCents: 13_520 },
    });
  });

  it('refuses a negative down payment or one above the price', () => {
    expect(quote(389_000, -1, 36)).toEqual({ ok: false, reason: 'down_payment_negative' });
    expect(quote(389_000, 389_001, 36)).toEqual({ ok: false, reason: 'down_payment_above_price' });
  });

  it('refuses to finance less than the smallest band, including a full down payment', () => {
    expect(quote(29_999, 0, 12)).toEqual({ ok: false, reason: 'below_minimum' });
    expect(quote(389_000, 389_000, 36)).toEqual({ ok: false, reason: 'below_minimum' });
  });

  it('refuses too much, unless enough is paid down', () => {
    expect(quote(26_000_000, 0, 48)).toEqual({ ok: false, reason: 'above_maximum' });
    expect(quote(26_000_000, 1_000_000, 48)).toMatchObject({ ok: true });
  });

  it('refuses a term that is not in the table', () => {
    expect(quote(389_000, 0, 30)).toEqual({ ok: false, reason: 'unknown_term' });
  });

  it('throws on fractions of a cent', () => {
    expect(() => quote(389_000.5, 0, 36)).toThrow(RangeError);
  });

  it('prices a big ticket: farm-002 with 20 000 € down over 48 months', () => {
    expect(quote(14_500_000, 2_000_000, 48)).toMatchObject({
      ok: true,
      // 12 500 000 × 0.021763 = 272 037.5 → 272 038 (half up)
      quote: { band: { band: 'D' }, monthlyNetCents: 272_038, buyoutCents: 1_000_000 },
    });
  });
});

describe('buyoutCents', () => {
  it('uses the percent for the term', () => {
    expect(buyoutCents(table, 389_000, 12)).toBe(155_600);
    expect(buyoutCents(table, 389_000, 48)).toBe(31_120);
  });

  it('rounds half up', () => {
    expect(buyoutCents(table, 10, 36)).toBe(2); // 1.5 → 2
  });

  it('throws for an unknown term', () => {
    expect(() => buyoutCents(table, 389_000, 30)).toThrow(RangeError);
  });
});

describe('availableTerms', () => {
  it('lists the terms every band supports, shortest first', () => {
    expect(availableTerms(table)).toEqual([12, 24, 36, 48]);
  });

  it('leaves out a term that a band does not price', () => {
    const [first, ...rest] = table.bands;
    const { '48': _dropped, ...factors } = first!.monthly_factor_by_term;
    const partial = { ...table, bands: [{ ...first!, monthly_factor_by_term: factors }, ...rest] };
    expect(availableTerms(partial)).toEqual([12, 24, 36]);
  });
});

describe('down payment limits', () => {
  it('lets the down payment go up to price − 300 €', () => {
    expect(maxDownPaymentCents(table, 389_000)).toBe(359_000);
    expect(maxDownPaymentCents(table, 30_000)).toBe(0);
    expect(maxDownPaymentCents(table, 10_000)).toBe(0);
  });

  it('needs a down payment only above 250 000 €', () => {
    expect(minDownPaymentCents(table, 25_000_000)).toBe(0);
    expect(minDownPaymentCents(table, 26_000_000)).toBe(1_000_000);
  });
});
