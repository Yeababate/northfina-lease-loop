import * as fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
import type { CoefficientTable, PriceList, VatRates } from '@/data/schemas';
import type { RentalDiscountRule } from './discounts';
import { calculateInvoices, invoiceSchedule } from './invoices';
import { priceContract } from './contract-pricing';
import { quoteLease } from './pricing';

const TERMS = [12, 24, 36, 48] as const;
const RATE_SCALE = 1_000_000;
const PROPERTY_ASSET_ID = 'fast-check-property-asset';
const dealerDiscount: RentalDiscountRule = {
  id: 'property-long-term-10-percent',
  revision: 7,
  name: 'Property test discount',
  minTermMonths: 36,
  maxTermMonths: 48,
  discountBps: 1000,
  enabled: true,
};

let table: CoefficientTable;
let lists: PriceList[];
let vat: VatRates;
beforeAll(async () => {
  [table, lists, vat] = await Promise.all([
    loadCoefficientTable(),
    loadPriceLists(),
    loadVatRates(),
  ]);
});

// Expected values below deliberately do not call the production calendar or rounding helpers.
function daysInMonth(year: number, month: number) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isoDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function expectedAnniversary(startOn: string, offset: number) {
  const [startYear = 0, startMonth = 0, startDay = 0] = startOn.split('-').map(Number);
  const monthIndex = startYear * 12 + startMonth - 1 + offset;
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  return isoDate(year, month, Math.min(startDay, daysInMonth(year, month)));
}

function isValidIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function roundRatioHalfUp(numerator: number, denominator: number) {
  return Math.floor((numerator + denominator / 2) / denominator);
}

function expectedRent(financedCents: number, factor: number) {
  return roundRatioHalfUp(financedCents * Math.round(factor * RATE_SCALE), RATE_SCALE);
}

function expectedVat(netCents: number, ratePercent: number) {
  return roundRatioHalfUp(netCents * Math.round(ratePercent * 10), 1000);
}

function expectedBuyout(table: CoefficientTable, financedCents: number, termMonths: number) {
  const percent = table.end_of_term_buyout_percent_of_financed[String(termMonths)];
  if (percent === undefined) throw new Error(`Missing fixture buyout for ${termMonths} months`);
  return roundRatioHalfUp(financedCents * Math.round(percent * 10), 1000);
}

function rateOnDate(rates: VatRates, date: string) {
  const rate = rates.rates.find(
    (candidate) =>
      candidate.valid_from <= date && (candidate.valid_to === null || date <= candidate.valid_to)
  );
  if (!rate) throw new Error(`Test fixture has no VAT rate for ${date}`);
  return rate;
}

const calendarDateArbitrary = fc
  .record({
    year: fc.integer({ min: 2026, max: 2028 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 31 }),
  })
  .map(({ year, month, day }) => isoDate(year, month, Math.min(day, daysInMonth(year, month))));

function assertSafeCents(amounts: number[]) {
  if (amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0))
    throw new Error('All amounts must be nonnegative safe integer cents');
}

describe('invoice rounding and totals properties', () => {
  it('keeps supported schedules on valid, anchored anniversaries across 2026–2028', () => {
    fc.assert(
      fc.property(calendarDateArbitrary, fc.constantFrom(...TERMS), (startOn, termMonths) => {
        const rows = invoiceSchedule(startOn, termMonths);
        expect(rows).toHaveLength(termMonths);
        const expectedDates = rows.map((_, index) => expectedAnniversary(startOn, index));
        expect(rows.map((row) => row.invoiceDate)).toEqual(expectedDates);
        expect(rows.map((row) => row.dueDate)).toEqual(expectedDates);
        expect(rows.map((row) => row.period)).toEqual(rows.map((_, index) => index + 1));
        expect(
          rows.every(
            (row, index) =>
              isValidIsoDate(row.invoiceDate) &&
              (index === 0 || rows[index - 1]!.invoiceDate < row.invoiceDate)
          )
        ).toBe(true);
      }),
      { numRuns: 1000 }
    );
  });

  it('reconciles 1,000 random signed offers, locked discounts, invoices and VAT totals', () => {
    const contractArbitrary = fc.integer({ min: 0, max: table.bands.length - 1 }).chain((index) => {
      const band = table.bands[index]!;
      return fc
        .integer({ min: band.min_financed_cents, max: band.max_financed_cents })
        .chain((listPriceCents) =>
          fc.record({
            termMonths: fc.constantFrom(...TERMS),
            listPriceCents: fc.constant(listPriceCents),
            downPaymentCents: fc.integer({ min: 0, max: listPriceCents - band.min_financed_cents }),
            startOn: calendarDateArbitrary,
          })
        );
    });

    fc.assert(
      fc.property(
        contractArbitrary,
        ({ termMonths, listPriceCents, downPaymentCents, startOn }) => {
          const testList: PriceList = {
            ...lists[0]!,
            valid_from: startOn,
            valid_to: null,
            prices: { [PROPERTY_ASSET_ID]: listPriceCents },
          };
          const signed = priceContract(
            [testList],
            table,
            {
              assetId: PROPERTY_ASSET_ID,
              termMonths,
              downPaymentCents,
              startOn,
            },
            startOn,
            [dealerDiscount]
          );
          expect(signed.ok).toBe(true);
          if (!signed.ok) throw new Error('Generated list price and down payment must be valid');

          const financedCents = listPriceCents - downPaymentCents;
          const band = table.bands.find(
            (candidate) =>
              financedCents >= candidate.min_financed_cents &&
              financedCents <= candidate.max_financed_cents
          );
          if (!band) throw new Error('Generated financed amount must fall within its band');
          const originalRent = expectedRent(
            financedCents,
            band.monthly_factor_by_term[String(termMonths)]!
          );
          const discountBps = termMonths >= 36 ? dealerDiscount.discountBps : 0;
          const discountCents = roundRatioHalfUp(originalRent * discountBps, 10_000);
          const lockedRent = originalRent - discountCents;
          const firstVat = expectedVat(lockedRent, rateOnDate(vat, startOn).rate_percent);
          expect(signed.price).toMatchObject({
            listPriceCents,
            downPaymentCents,
            financedCents,
            termMonths,
            originalMonthlyNetCents: originalRent,
            monthlyDiscountCents: discountCents,
            monthlyNetCents: lockedRent,
            buyoutNetCents: expectedBuyout(table, financedCents, termMonths),
            discountBps,
            discountRuleId: discountBps ? dealerDiscount.id : null,
            discountRuleRevision: discountBps ? dealerDiscount.revision : null,
          });
          assertSafeCents([
            signed.price.listPriceCents,
            signed.price.downPaymentCents,
            signed.price.financedCents,
            signed.price.originalMonthlyNetCents,
            signed.price.monthlyDiscountCents,
            signed.price.monthlyNetCents,
            signed.price.buyoutNetCents,
          ]);

          const sliderQuote = quoteLease(
            table,
            {
              listPriceCents,
              downPaymentCents,
              termMonths,
              vatRatePercent: rateOnDate(vat, startOn).rate_percent,
            },
            [dealerDiscount]
          );
          expect(sliderQuote.ok).toBe(true);
          if (!sliderQuote.ok) throw new Error('Generated slider quote must be valid');
          expect([sliderQuote.quote.monthlyVatCents, sliderQuote.quote.monthlyGrossCents]).toEqual([
            firstVat,
            lockedRent + firstVat,
          ]);
          assertSafeCents([
            sliderQuote.quote.listPriceCents,
            sliderQuote.quote.downPaymentCents,
            sliderQuote.quote.financedCents,
            sliderQuote.quote.originalMonthlyNetCents,
            sliderQuote.quote.monthlyDiscountCents,
            sliderQuote.quote.monthlyNetCents,
            sliderQuote.quote.monthlyVatCents,
            sliderQuote.quote.monthlyGrossCents,
            sliderQuote.quote.buyoutCents,
            sliderQuote.quote.totalNetCents,
          ]);
          expect([
            sliderQuote.quote.monthlyNetCents,
            sliderQuote.quote.buyoutCents,
            sliderQuote.quote.totalNetCents,
          ]).toEqual([
            signed.price.monthlyNetCents,
            signed.price.buyoutNetCents,
            downPaymentCents + lockedRent * termMonths,
          ]);

          const invoices = calculateInvoices(signed.price, vat);
          expect(invoices.ok).toBe(true);
          if (!invoices.ok) throw new Error('Every generated invoice date has a VAT rate');
          expect(invoices.invoices).toHaveLength(termMonths);
          const byRate = new Map<number, { net: number; tax: number; gross: number }>();
          let everyRowMatches = true;
          invoices.invoices.forEach((invoice, index) => {
            const expectedDate = expectedAnniversary(startOn, index);
            const rate = rateOnDate(vat, expectedDate).rate_percent;
            const tax = expectedVat(lockedRent, rate);
            everyRowMatches &&=
              isValidIsoDate(invoice.invoiceDate) &&
              invoice.period === index + 1 &&
              invoice.invoiceDate === expectedDate &&
              invoice.dueDate === expectedDate &&
              (index === 0 || invoices.invoices[index - 1]!.invoiceDate < invoice.invoiceDate) &&
              invoice.netCents === lockedRent &&
              invoice.vatPercent === rate &&
              invoice.vatCents === tax &&
              invoice.grossCents === lockedRent + tax &&
              [invoice.netCents, invoice.vatCents, invoice.grossCents].every(
                (amount) => Number.isSafeInteger(amount) && amount >= 0
              );
            assertSafeCents([invoice.netCents, invoice.vatCents, invoice.grossCents]);

            const totals = byRate.get(rate) ?? { net: 0, tax: 0, gross: 0 };
            totals.net += invoice.netCents;
            totals.tax += invoice.vatCents;
            totals.gross += invoice.grossCents;
            byRate.set(rate, totals);
          });
          expect(everyRowMatches).toBe(true);

          const netInvoices = invoices.invoices.reduce((sum, row) => sum + row.netCents, 0);
          const taxInvoices = invoices.invoices.reduce((sum, row) => sum + row.vatCents, 0);
          const grossInvoices = invoices.invoices.reduce((sum, row) => sum + row.grossCents, 0);
          expect(netInvoices).toBe(lockedRent * termMonths);
          expect(downPaymentCents + netInvoices).toBe(sliderQuote.quote.totalNetCents);
          expect(grossInvoices).toBe(netInvoices + taxInvoices);
          expect(
            [...byRate.values()].every((totals) => totals.gross === totals.net + totals.tax)
          ).toBe(true);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('never raises rent when financed amount falls within the same pricing band', () => {
    const downPaymentPairArbitrary = fc
      .integer({ min: 0, max: table.bands.length - 1 })
      .chain((index) => {
        const band = table.bands[index]!;
        return fc
          .integer({ min: band.min_financed_cents, max: band.max_financed_cents })
          .chain((listPriceCents) =>
            fc.record({
              termMonths: fc.constantFrom(...TERMS),
              listPriceCents: fc.constant(listPriceCents),
              firstDownPaymentCents: fc.integer({
                min: 0,
                max: listPriceCents - band.min_financed_cents,
              }),
              secondDownPaymentCents: fc.integer({
                min: 0,
                max: listPriceCents - band.min_financed_cents,
              }),
            })
          );
      });

    fc.assert(
      fc.property(
        downPaymentPairArbitrary,
        ({ termMonths, listPriceCents, firstDownPaymentCents, secondDownPaymentCents }) => {
          const smallerDownPayment = Math.min(firstDownPaymentCents, secondDownPaymentCents);
          const largerDownPayment = Math.max(firstDownPaymentCents, secondDownPaymentCents);
          const lessFinanced = quoteLease(
            table,
            {
              listPriceCents,
              downPaymentCents: largerDownPayment,
              termMonths,
              vatRatePercent: 25.5,
            },
            [dealerDiscount]
          );
          const moreFinanced = quoteLease(
            table,
            {
              listPriceCents,
              downPaymentCents: smallerDownPayment,
              termMonths,
              vatRatePercent: 25.5,
            },
            [dealerDiscount]
          );
          expect(lessFinanced.ok).toBe(true);
          expect(moreFinanced.ok).toBe(true);
          if (!lessFinanced.ok || !moreFinanced.ok)
            throw new Error('Both generated financed amounts are within one band');
          expect(lessFinanced.quote.band.band).toBe(moreFinanced.quote.band.band);
          expect(lessFinanced.quote.financedCents).toBeLessThanOrEqual(
            moreFinanced.quote.financedCents
          );
          expect(lessFinanced.quote.monthlyNetCents).toBeLessThanOrEqual(
            moreFinanced.quote.monthlyNetCents
          );
          expect(largerDownPayment).toBeGreaterThanOrEqual(smallerDownPayment);
        }
      ),
      { numRuns: 1000 }
    );
  });
});

describe('fixed money scenario regressions', () => {
  it('card 3: ebike-001 keeps net rent locked across the January 2027 VAT change', () => {
    const signed = priceContract(
      lists,
      table,
      { assetId: 'ebike-001', termMonths: 24, downPaymentCents: 0, startOn: '2026-09-15' },
      '2026-09-15'
    );
    expect(signed.ok).toBe(true);
    if (!signed.ok) throw new Error('Scenario card 3 must be priceable');
    expect(signed.price.listPriceCents).toBe(189_900);
    expect(signed.price.monthlyNetCents).toBe(6_957);

    const result = calculateInvoices(signed.price, vat);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Scenario card 3 invoices need VAT');
    expect(result.invoices).toHaveLength(24);
    expect(result.invoices[3]).toMatchObject({
      invoiceDate: '2026-12-15',
      dueDate: '2026-12-15',
      netCents: 6_957,
      vatPercent: 25.5,
      vatCents: 1_774,
      grossCents: 8_731,
    });
    expect(result.invoices[4]).toMatchObject({
      invoiceDate: '2027-01-15',
      dueDate: '2027-01-15',
      netCents: 6_957,
      vatPercent: 26,
      vatCents: 1_809,
      grossCents: 8_766,
    });
  });

  it('card 4: laptop-001 returns to the 31st after February, including leap-year February 2028', () => {
    const signed = priceContract(
      lists,
      table,
      { assetId: 'laptop-001', termMonths: 36, downPaymentCents: 0, startOn: '2026-01-31' },
      '2026-01-31'
    );
    expect(signed.ok).toBe(true);
    if (!signed.ok) throw new Error('Scenario card 4 must be priceable');
    expect(signed.price.listPriceCents).toBe(119_900);
    expect(signed.price.monthlyNetCents).toBe(3_432);

    const result = calculateInvoices(signed.price, vat);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Scenario card 4 invoices need VAT');
    expect(result.invoices).toHaveLength(36);
    expect(result.invoices[1]).toMatchObject({
      invoiceDate: '2026-02-28',
      dueDate: '2026-02-28',
      netCents: 3_432,
      vatPercent: 25.5,
      vatCents: 875,
      grossCents: 4_307,
    });
    expect(result.invoices[25]).toMatchObject({
      invoiceDate: '2028-02-29',
      dueDate: '2028-02-29',
      netCents: 3_432,
      vatPercent: 26,
      vatCents: 892,
      grossCents: 4_324,
    });
    expect(result.invoices[26]?.invoiceDate).toBe('2028-03-31');
  });
});
