// When an early-exit price becomes final, and what it costs with VAT.
//
// RULE: a price is frozen only when the deal is binding, the way a lease price is frozen at
// signing. For an early exit that is COMPLETION: the provider has confirmed the buyout payment,
// or the item is back, balances are reviewed and the exit date has arrived. Until then a
// stored request holds an indicative quote that is re-priced with current data on every read
// and at completion, so an inspection recorded after the request changes the price.
//
// At completion the NET amount and its breakdown are frozen (quote.frozenOn). VAT is never
// frozen: the gross is the frozen net plus VAT at the rate on the invoice date, so a VAT change
// between completion and invoicing changes the total but not the net.
import type { VatRate } from '@/data/schemas';
import {
  isFairExitQuote,
  priceExitPeriod,
  type ExitContract,
  type ExitPricing,
  type ExitQuote,
} from './early-exit';
import { vatCents, vatRateOn } from './vat';

/**
 * The price of a stored request now. A frozen quote is returned unchanged; so is a quote
 * stored under a v1 method, which keeps the v1 price it was requested with. A v2 quote is
 * priced again over its stored period with current data, keeping its contract revision.
 */
export function repriceExitRequest(
  contract: ExitContract,
  stored: ExitQuote,
  pricing: ExitPricing
): { ok: true; quote: ExitQuote } | { ok: false; reason: 'price_unavailable' } {
  if (stored.frozenOn !== undefined || !isFairExitQuote(stored)) return { ok: true, quote: stored };
  const result = priceExitPeriod(contract, stored.kind, stored, pricing);
  if (!result.ok) return result;
  return { ok: true, quote: { ...result.quote, contractRevision: stored.contractRevision } };
}

/** Freezes the net amount and breakdown on the completion day. Idempotent. */
export function freezeExitQuote(quote: ExitQuote, completedOn: string): ExitQuote {
  return quote.frozenOn !== undefined ? quote : { ...quote, frozenOn: completedOn };
}

export type ExitPriceChange = {
  /** Why the current price differs from the one shown at request time. */
  reason: 'inspection' | 'valuation' | 'vat' | 'price';
  previousNetCents: number;
};

/** How the current price differs from the stored one, or null when nothing changed. */
export function exitPriceChange(stored: ExitQuote, current: ExitQuote): ExitPriceChange | null {
  const change = (reason: ExitPriceChange['reason']) => ({
    reason,
    previousNetCents: stored.amountNetCents,
  });
  if (!isFairExitQuote(stored) || !isFairExitQuote(current)) {
    return stored.amountNetCents === current.amountNetCents ? null : change('price');
  }
  const before = stored.breakdown;
  const after = current.breakdown;
  const newlyInspected = after.valuedItems.some((item) => {
    if (item.basis !== 'inspected') return false;
    const earlier = before.valuedItems.find((old) => old.assetId === item.assetId);
    return (
      earlier?.basis !== 'inspected' ||
      earlier.condition !== item.condition ||
      earlier.usageValue !== item.usageValue
    );
  });
  if (newlyInspected) return change('inspection');
  if (before.marketValueCents !== after.marketValueCents) return change('valuation');
  if (before.netCents !== after.netCents) return change('price');
  if (before.vatRatePercent !== after.vatRatePercent || before.vatCents !== after.vatCents) {
    return change('vat');
  }
  return null;
}

export type ExitCharge = {
  netCents: number;
  vatRatePercent: number;
  vatCents: number;
  grossCents: number;
  invoiceOn: string;
};

/** The frozen net plus VAT at the rate on `invoiceOn`, rounded once, half up (vatCents). */
export function exitCharge(
  netCents: number,
  vatRates: readonly VatRate[],
  invoiceOn: string
): { ok: true; charge: ExitCharge } | { ok: false; reason: 'no_rate_on_date' } {
  const rate = vatRateOn(vatRates, invoiceOn);
  if (!rate.ok) return rate;
  const vat = vatCents(netCents, rate.rate.rate_percent);
  return {
    ok: true,
    charge: {
      netCents,
      vatRatePercent: rate.rate.rate_percent,
      vatCents: vat,
      grossCents: netCents + vat,
      invoiceOn,
    },
  };
}
