import { isoDateSchema, type VatRate } from '@/data/schemas';
import { earlyExitPeriod } from './early-exit-period';
import { BUYOUT_METHOD, CANCELLATION_METHOD } from './early-exit-price';
import {
  FAIR_EXIT_METHOD,
  fairExitPrice,
  sameBreakdown,
  type FairExitBreakdown,
} from './fair-exit';
import type { ReturnValuation } from './fair-exit-valuation';
import { vatRateOn } from './vat';

export type ExitKind = 'return' | 'buyout';
export type ExitContract = Readonly<{
  id: string;
  renterId: string | null;
  providerId: string | null;
  startOn: string;
  endOn: string;
  termMonths: number;
  monthlyNetCents: number;
  buyoutNetCents: number;
  status: string;
  revision: number;
}>;

export type ExitQuote = {
  contractId: string;
  kind: ExitKind;
  effectiveEndOn: string;
  periodStartOn: string;
  elapsedMonths: number;
  remainingMonths: number;
  monthlyRentCents: number;
  amountNetCents: number;
  /**
   * The policy that priced the quote. New quotes are `fair-exit-v2` and carry a breakdown.
   * Quotes stored before v2 keep their v1 method (`half-remaining-rent-v1`,
   * `remaining-rent-plus-buyout-v1`) and amount, and are explained with the v1 rule.
   */
  method: string;
  contractRevision: number;
  /** v2 only: every step of the price, net, VAT and gross. */
  breakdown?: FairExitBreakdown;
};

export type ExitPreviewFailure =
  | 'not_renter'
  | 'not_active'
  | 'participants_missing'
  | 'not_started'
  | 'already_ended'
  | 'price_unavailable';

/** What fair-exit-v2 needs besides the contract: all loaded by the server and passed in. */
export type ExitPricing = Readonly<{
  /** The contract band's annual_interest_percent, or null if its band can't be found. */
  annualInterestPercent: number | null;
  vatRates: readonly VatRate[];
  /** The returned items' market value on the exit date (see fair-exit-valuation.ts). */
  valueReturn: (on: string) => ReturnValuation;
}>;

/** True for a stored quote priced and explained by fair-exit-v2. */
export function isFairExitQuote(
  quote: ExitQuote
): quote is ExitQuote & { breakdown: FairExitBreakdown } {
  return quote.method === FAIR_EXIT_METHOD && quote.breakdown !== undefined;
}

/** The v1 method a stored quote of this kind was priced with, before v2. */
export function legacyExitMethod(kind: ExitKind): string {
  return kind === 'return' ? CANCELLATION_METHOD : BUYOUT_METHOD;
}

/**
 * A new quote, always priced with fair-exit-v2 (fair-exit.ts). The exit takes effect at the
 * end of the current, already earned month; the price and its VAT are worked out for that day.
 */
export function previewEarlyExit(
  contract: ExitContract,
  kind: ExitKind,
  userId: string,
  requestedOn: string,
  pricing: ExitPricing
): { ok: true; quote: ExitQuote } | { ok: false; reason: ExitPreviewFailure } {
  if (!contract.renterId || !contract.providerId)
    return { ok: false, reason: 'participants_missing' };
  if (userId !== contract.renterId) return { ok: false, reason: 'not_renter' };
  if (contract.status !== 'active') return { ok: false, reason: 'not_active' };
  const result = earlyExitPeriod(contract, requestedOn);
  if (!result.ok) return result;
  const { effectiveEndOn, remainingMonths } = result.period;
  const vat = vatRateOn(pricing.vatRates, effectiveEndOn);
  if (pricing.annualInterestPercent === null || !vat.ok) {
    return { ok: false, reason: 'price_unavailable' };
  }
  const valuation = kind === 'return' ? pricing.valueReturn(effectiveEndOn) : null;
  if (valuation && !valuation.ok) return { ok: false, reason: 'price_unavailable' };
  const breakdown = fairExitPrice({
    kind,
    monthlyRentCents: contract.monthlyNetCents,
    remainingMonths,
    endOfTermBuyoutCents: contract.buyoutNetCents,
    annualInterestPercent: pricing.annualInterestPercent,
    vatRatePercent: vat.rate.rate_percent,
    ...(valuation ? { valuation } : {}),
  });
  return {
    ok: true,
    quote: {
      contractId: contract.id,
      kind,
      ...result.period,
      monthlyRentCents: contract.monthlyNetCents,
      amountNetCents: breakdown.netCents,
      method: FAIR_EXIT_METHOD,
      contractRevision: contract.revision,
      breakdown,
    },
  };
}

/** Exact accepted input comparison; stale amounts/periods/methods need a fresh preview. */
export function sameExitQuote(a: ExitQuote, b: ExitQuote): boolean {
  return (
    a.contractId === b.contractId &&
    a.kind === b.kind &&
    a.effectiveEndOn === b.effectiveEndOn &&
    a.periodStartOn === b.periodStartOn &&
    a.elapsedMonths === b.elapsedMonths &&
    a.remainingMonths === b.remainingMonths &&
    a.monthlyRentCents === b.monthlyRentCents &&
    a.amountNetCents === b.amountNetCents &&
    a.method === b.method &&
    a.contractRevision === b.contractRevision &&
    sameBreakdown(a.breakdown, b.breakdown)
  );
}

/** Physical receipt alone does not end rent early or complete only part of a bundle. */
export function returnCanComplete(
  effectiveEndOn: string,
  assetIds: readonly string[],
  receivedAssetIds: readonly string[],
  balancesReviewed: boolean,
  today: string
): boolean {
  isoDateSchema.parse(today);
  isoDateSchema.parse(effectiveEndOn);
  return (
    balancesReviewed &&
    today >= effectiveEndOn &&
    assetIds.length > 0 &&
    new Set(assetIds).size === assetIds.length &&
    assetIds.every((id) => receivedAssetIds.includes(id))
  );
}
