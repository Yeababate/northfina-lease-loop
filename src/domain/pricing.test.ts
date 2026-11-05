import { beforeAll, describe, expect, it } from 'vitest';
import { loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
import { invoicePrice, priceContract } from './pricing';

let lists: Awaited<ReturnType<typeof loadPriceLists>>;
let table: Awaited<ReturnType<typeof loadCoefficientTable>>;
let vat: Awaited<ReturnType<typeof loadVatRates>>;
beforeAll(async () => {
  [lists, table, vat] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
  ]);
});
const input = { assetId: 'ebike-003', termMonths: 36, downPaymentCents: 0 };

describe('priceContract', () => {
  it('matches the worked example, with an independent snapshot', () => {
    const result = priceContract(lists, table, input, '2026-11-05');
    expect(result).toMatchObject({
      ok: true,
      price: {
        monthlyNetCents: 10730,
        buyoutNetCents: 58350,
        financedCents: 389000,
        priceListVersion: 1,
        endOn: '2029-11-05',
      },
    });
    if (!result.ok) throw new Error('price failed');
    const changed = structuredClone(lists);
    changed[0]!.prices['ebike-003'] = 100000;
    expect(priceContract(changed, table, input, '2026-11-05')).not.toEqual(result);
    expect(result.price.monthlyNetCents).toBe(10730);
  });
  it('uses signing date rather than earlier quote date', () => {
    const laptop = { ...input, assetId: 'laptop-004' };
    const quote = priceContract(lists, table, laptop, '2026-11-05');
    const signed = priceContract(lists, table, laptop, '2026-11-06');
    expect(quote).toMatchObject({ ok: true, price: { priceListVersion: 1 } });
    expect(signed).toMatchObject({ ok: true, price: { priceListVersion: 2 } });
    if (quote.ok && signed.ok)
      expect(signed.price.listPriceCents).toBe(lists[1]!.prices['laptop-004']);
  });
  it.each([-1, 389001])('rejects invalid down payment %s', (downPaymentCents) => {
    expect(priceContract(lists, table, { ...input, downPaymentCents }, '2026-11-05')).toEqual({
      ok: false,
      reason: 'invalid_down_payment',
    });
  });
  it('rejects fractions and invalid dates', () => {
    expect(() =>
      priceContract(lists, table, { ...input, downPaymentCents: 0.5 }, '2026-11-05')
    ).toThrow();
    expect(() => priceContract(lists, table, input, '2026-02-30')).toThrow();
  });
  it.each([
    ['below_minimum', 389000],
    ['unknown_term', 0],
  ])('handles %s', (reason, downPaymentCents) => {
    expect(
      priceContract(
        lists,
        table,
        { ...input, downPaymentCents, termMonths: reason === 'unknown_term' ? 13 : 36 },
        '2026-11-05'
      )
    ).toEqual({ ok: false, reason });
  });
  it('handles missing data and future coefficients', () => {
    expect(priceContract([], table, input, '2026-11-05')).toEqual({
      ok: false,
      reason: 'no_price_list_on_date',
    });
    expect(priceContract(lists, table, { ...input, assetId: 'missing' }, '2026-11-05')).toEqual({
      ok: false,
      reason: 'unknown_asset',
    });
    expect(
      priceContract(lists, { ...table, valid_from: '2027-01-01' }, input, '2026-11-05')
    ).toEqual({ ok: false, reason: 'no_coefficient_on_date' });
    expect(
      priceContract(
        lists,
        { ...table, end_of_term_buyout_percent_of_financed: {} },
        input,
        '2026-11-05'
      )
    ).toEqual({ ok: false, reason: 'unknown_term' });
  });
  it('selects bands after subtracting down payment', () => {
    expect(
      priceContract(lists, table, { ...input, downPaymentCents: 189001 }, '2026-11-05')
    ).toMatchObject({ ok: true, price: { band: 'A', financedCents: 199999 } });
    expect(
      priceContract(lists, table, { ...input, downPaymentCents: 189000 }, '2026-11-05')
    ).toMatchObject({ ok: true, price: { band: 'B', financedCents: 200000 } });
  });
});

describe('invoicePrice', () => {
  it('keeps net rent locked across the fictional tax boundary', () => {
    expect(invoicePrice({ monthlyNetCents: 10730 }, vat, '2026-12-31')).toEqual({
      ok: true,
      netCents: 10730,
      vatPercent: 25.5,
      vatCents: 2736,
      totalCents: 13466,
    });
    expect(invoicePrice({ monthlyNetCents: 10730 }, vat, '2027-01-01')).toEqual({
      ok: true,
      netCents: 10730,
      vatPercent: 26,
      vatCents: 2790,
      totalCents: 13520,
    });
  });
  it('rounds half cents up and handles zero', () => {
    expect(invoicePrice({ monthlyNetCents: 100 }, vat, '2026-11-05')).toMatchObject({
      vatCents: 26,
    });
    expect(invoicePrice({ monthlyNetCents: 0 }, vat, '2026-11-05')).toMatchObject({
      totalCents: 0,
    });
  });
  it('handles missing VAT and invalid input', () => {
    expect(invoicePrice({ monthlyNetCents: 1 }, { ...vat, rates: [] }, '2026-11-05')).toEqual({
      ok: false,
      reason: 'no_vat_on_date',
    });
    expect(invoicePrice({ monthlyNetCents: 1 }, vat, '1900-01-01')).toMatchObject({ ok: false });
    expect(() => invoicePrice({ monthlyNetCents: -1 }, vat, '2026-11-05')).toThrow();
    expect(() => invoicePrice({ monthlyNetCents: 0.5 }, vat, '2026-11-05')).toThrow();
    expect(() => invoicePrice({ monthlyNetCents: 1 }, vat, 'invalid')).toThrow();
  });
});
