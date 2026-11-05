// Pricing: what a lease costs per month, at the end, and in total.
//
//   financed amount  = net list price − down payment
//   monthly net rent = financed amount × factor (band by financed amount, column by term)
//   monthly VAT      = monthly net rent × VAT rate on the invoice date
//   buyout           = financed amount × buyout percent for the term
//
// Each line is rounded once, half up (see ./rounding.ts). Totals are sums of already-rounded
// lines, so every number the customer sees adds up exactly.
import type { CoefficientBand, CoefficientTable } from '@/data/schemas';
import { monthlyFactorFor } from './coefficient';
import { divideRoundHalfUp, toScaledInteger } from './rounding';
import { vatCents } from './vat';

export type LeaseQuoteInput = {
  listPriceCents: number;
  downPaymentCents: number;
  termMonths: number;
  /** VAT rate on the date the customer will see the first invoice, e.g. 25.5. */
  vatRatePercent: number;
};

export type LeaseQuote = {
  listPriceCents: number;
  downPaymentCents: number;
  financedCents: number;
  termMonths: number;
  band: CoefficientBand;
  factor: number;
  monthlyNetCents: number;
  vatRatePercent: number;
  monthlyVatCents: number;
  monthlyGrossCents: number;
  /** Price to buy the item when the lease ends. Optional for the customer. */
  buyoutCents: number;
  /** Down payment + every monthly net rent. Net of VAT, without the optional buyout. */
  totalNetCents: number;
};

export type LeaseQuoteResult =
  | { ok: true; quote: LeaseQuote }
  | {
      ok: false;
      reason:
        | 'down_payment_negative'
        | 'down_payment_above_price'
        | 'below_minimum'
        | 'above_maximum'
        | 'unknown_term';
    };

/** The term a new visitor sees first. Matches scenario card 1. */
export const DEFAULT_TERM_MONTHS = 36;

/** Factors in the table have six decimals: 0.027584 is 27 584 millionths. */
const FACTOR_SCALE = 1_000_000;

/** Prices one lease. Returns a reason instead of throwing when the deal is not possible. */
export function quoteLease(table: CoefficientTable, input: LeaseQuoteInput): LeaseQuoteResult {
  const { listPriceCents, downPaymentCents, termMonths, vatRatePercent } = input;
  if (!Number.isInteger(listPriceCents) || !Number.isInteger(downPaymentCents)) {
    throw new RangeError('list price and down payment must be whole cents');
  }
  if (downPaymentCents < 0) return { ok: false, reason: 'down_payment_negative' };
  if (downPaymentCents > listPriceCents) return { ok: false, reason: 'down_payment_above_price' };

  const financedCents = listPriceCents - downPaymentCents;
  const factorResult = monthlyFactorFor(table, financedCents, termMonths);
  if (!factorResult.ok) return factorResult;

  const { band, factor } = factorResult;
  const monthlyNetCents = divideRoundHalfUp(
    financedCents * toScaledInteger(factor, FACTOR_SCALE),
    FACTOR_SCALE
  );
  const monthlyVatCents = vatCents(monthlyNetCents, vatRatePercent);

  return {
    ok: true,
    quote: {
      listPriceCents,
      downPaymentCents,
      financedCents,
      termMonths,
      band,
      factor,
      monthlyNetCents,
      vatRatePercent,
      monthlyVatCents,
      monthlyGrossCents: monthlyNetCents + monthlyVatCents,
      buyoutCents: buyoutCents(table, financedCents, termMonths),
      totalNetCents: downPaymentCents + monthlyNetCents * termMonths,
    },
  };
}

/** Buyout at the end of the term: a percent of the financed amount, rounded half up. */
export function buyoutCents(
  table: CoefficientTable,
  financedCents: number,
  termMonths: number
): number {
  const percent = table.end_of_term_buyout_percent_of_financed[String(termMonths)];
  if (percent === undefined) throw new RangeError(`no buyout percent for ${termMonths} months`);
  return divideRoundHalfUp(financedCents * toScaledInteger(percent, 10), 1000);
}

/** The terms a customer can choose, shortest first: [12, 24, 36, 48]. */
export function availableTerms(table: CoefficientTable): number[] {
  return Object.keys(table.end_of_term_buyout_percent_of_financed)
    .map(Number)
    .filter((term) => table.bands.every((band) => band.monthly_factor_by_term[String(term)]))
    .sort((a, b) => a - b);
}

/**
 * The largest down payment that still leaves something to finance. Above this the financed
 * amount drops under the smallest band, so the slider stops here. 0 if the item is too cheap.
 */
export function maxDownPaymentCents(table: CoefficientTable, listPriceCents: number): number {
  const minimumFinanced = Math.min(...table.bands.map((b) => b.min_financed_cents));
  return Math.max(0, listPriceCents - minimumFinanced);
}

/**
 * The smallest down payment that brings the financed amount into the table. Non-zero only
 * for items above the largest band, which can be leased with enough money down.
 */
export function minDownPaymentCents(table: CoefficientTable, listPriceCents: number): number {
  const maximumFinanced = Math.max(...table.bands.map((b) => b.max_financed_cents));
  return Math.max(0, listPriceCents - maximumFinanced);
}
