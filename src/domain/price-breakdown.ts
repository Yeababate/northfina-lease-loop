// "Explain my price" (#48): one lease quote broken down into what the customer pays in total,
// and a side-by-side comparison of 2–4 term / down-payment options. Shared by the item page and
// GET /api/assets/:id/compare, so both always show the same numbers.
//
// Money rules: every amount is integer cents. Rents are the locked monthly net rent times the
// term (no rounding). VAT is worked out per invoice with the rate on that invoice's own date
// (calculateInvoices, rounded once per invoice, half up), so a lease that crosses a VAT change
// shows both rates. The down payment is taxed at the start date's rate and the optional buyout
// at the end date's rate, each rounded once, half up (vatCents).
import type { CoefficientTable, VatRates } from '@/data/schemas';
import { contractEndOn } from './contract-period';
import type { RentalDiscountRule } from './discounts';
import { calculateInvoices } from './invoices';
import { quoteLease, type LeaseQuote, type LeaseQuoteResult } from './pricing';
import { divideRoundHalfUp, toScaledInteger } from './rounding';
import { vatCents, vatRateOn } from './vat';

export type PriceBreakdown = {
  quote: LeaseQuote;
  /** The monthly factor as basis points of the financed amount: 0.027584 → 276 (2.76 %). */
  monthlyFactorBps: number;
  /** All monthly rents, net: monthly net rent × months. */
  rentsNetCents: number;
  /** All monthly rents with the VAT on each invoice date; null if a date has no VAT rate. */
  rentsGrossCents: number | null;
  /** The VAT rates the invoices use, in date order, with how many invoices each covers. */
  vatRates: { ratePercent: number; invoices: number }[];
  /** Down payment + all rents, net. What leasing costs if the item is handed back. */
  totalNetCents: number;
  totalGrossCents: number | null;
  /** Total plus the optional buyout at the end: the cost of leasing and then keeping it. */
  totalIfKeptNetCents: number;
  totalIfKeptGrossCents: number | null;
  /** Leasing and keeping it, minus buying it today at the list price (net). */
  costOfLeasingNetCents: number;
};

/** Breaks one quote down for a lease starting on `startOn` (ISO date). */
export function breakdown(quote: LeaseQuote, vat: VatRates, startOn: string): PriceBreakdown {
  const rentsNetCents = quote.monthlyNetCents * quote.termMonths;
  const invoices = calculateInvoices(
    {
      signedOn: startOn,
      startOn,
      termMonths: quote.termMonths,
      monthlyNetCents: quote.monthlyNetCents,
    },
    vat
  );
  const rentsGrossCents = invoices.ok
    ? invoices.invoices.reduce((sum, invoice) => sum + invoice.grossCents, 0)
    : null;
  const vatRates: PriceBreakdown['vatRates'] = [];
  if (invoices.ok) {
    for (const invoice of invoices.invoices) {
      const last = vatRates.at(-1);
      if (last && last.ratePercent === invoice.vatPercent) last.invoices += 1;
      else vatRates.push({ ratePercent: invoice.vatPercent, invoices: 1 });
    }
  }

  const downGross = grossOn(quote.downPaymentCents, vat, startOn);
  const buyoutGross = grossOn(quote.buyoutCents, vat, contractEndOn(startOn, quote.termMonths));
  const totalNetCents = quote.downPaymentCents + rentsNetCents;
  const totalGrossCents =
    rentsGrossCents === null || downGross === null ? null : downGross + rentsGrossCents;
  const totalIfKeptNetCents = totalNetCents + quote.buyoutCents;

  return {
    quote,
    monthlyFactorBps: divideRoundHalfUp(toScaledInteger(quote.factor, 1_000_000), 100),
    rentsNetCents,
    rentsGrossCents,
    vatRates,
    totalNetCents,
    totalGrossCents,
    totalIfKeptNetCents,
    totalIfKeptGrossCents:
      totalGrossCents === null || buyoutGross === null ? null : totalGrossCents + buyoutGross,
    costOfLeasingNetCents: totalIfKeptNetCents - quote.listPriceCents,
  };
}

function grossOn(netCents: number, vat: VatRates, isoDate: string): number | null {
  const rate = vatRateOn(vat.rates, isoDate);
  return rate.ok ? netCents + vatCents(netCents, rate.rate.rate_percent) : null;
}

export type CompareOption = { termMonths: number; downPaymentCents: number };

export type ComparedOption = CompareOption &
  (
    | {
        ok: true;
        breakdown: PriceBreakdown;
        /** How much more per month than the lowest monthly option (0 for that one). */
        monthlyAboveLowestCents: number;
        /** How much more in total (net, without buyout) than the lowest-total option. */
        totalAboveLowestCents: number;
      }
    | { ok: false; reason: Extract<LeaseQuoteResult, { ok: false }>['reason'] | 'no_vat_rate' }
  );

export type Comparison = {
  options: ComparedOption[];
  /** Index into `options` of the lowest monthly rent, or null if none can be priced. */
  lowestMonthly: number | null;
  /** Index of the lowest total (down payment + all rents, net), or null. */
  lowestTotal: number | null;
};

export const MIN_COMPARE_OPTIONS = 2;
export const MAX_COMPARE_OPTIONS = 4;

/**
 * Prices 2–4 options side by side. Options that cannot be leased come back with a reason
 * instead of throwing. Ties go to the earlier option.
 */
export function compareOptions(
  input: {
    table: CoefficientTable;
    discountRules?: readonly RentalDiscountRule[];
    listPriceCents: number;
    vat: VatRates;
    startOn: string;
  },
  options: readonly CompareOption[]
): Comparison {
  if (options.length < MIN_COMPARE_OPTIONS || options.length > MAX_COMPARE_OPTIONS) {
    throw new RangeError(
      `Compare ${MIN_COMPARE_OPTIONS}–${MAX_COMPARE_OPTIONS} options, got ${options.length}`
    );
  }
  const startRate = vatRateOn(input.vat.rates, input.startOn);
  const priced = options.map((option) => {
    if (!startRate.ok) return { ...option, ok: false as const, reason: 'no_vat_rate' as const };
    const result = quoteLease(
      input.table,
      {
        listPriceCents: input.listPriceCents,
        ...option,
        vatRatePercent: startRate.rate.rate_percent,
      },
      input.discountRules
    );
    return result.ok
      ? {
          ...option,
          ok: true as const,
          breakdown: breakdown(result.quote, input.vat, input.startOn),
        }
      : { ...option, ok: false as const, reason: result.reason };
  });

  const lowestBy = (value: (b: PriceBreakdown) => number) => {
    let index: number | null = null;
    priced.forEach((option, i) => {
      if (!option.ok) return;
      const best = index === null ? null : priced[index];
      if (!best || !best.ok || value(option.breakdown) < value(best.breakdown)) index = i;
    });
    return index;
  };
  const monthly = (b: PriceBreakdown) => b.quote.monthlyNetCents;
  const total = (b: PriceBreakdown) => b.totalNetCents;
  const lowestMonthly = lowestBy(monthly);
  const lowestTotal = lowestBy(total);
  const floor = (index: number | null, value: (b: PriceBreakdown) => number) => {
    const option = index === null ? null : priced[index];
    return option?.ok ? value(option.breakdown) : 0;
  };

  return {
    lowestMonthly,
    lowestTotal,
    options: priced.map((option) =>
      option.ok
        ? {
            ...option,
            monthlyAboveLowestCents: monthly(option.breakdown) - floor(lowestMonthly, monthly),
            totalAboveLowestCents: total(option.breakdown) - floor(lowestTotal, total),
          }
        : option
    ),
  };
}
