// VAT: which rate applies on a date, and how much VAT a net amount carries.
// The rate is looked up per date on purpose: a locked net rent still pays the VAT rate of
// each invoice date (see the 1 Jan 2027 change in data/vat-rates.json).
import type { VatRate } from '@/data/schemas';
import { divideRoundHalfUp, toScaledInteger } from './rounding';

export type VatRateResult = { ok: true; rate: VatRate } | { ok: false; reason: 'no_rate_on_date' };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The VAT rate valid on `isoDate`. Both ends of a rate's validity are included. */
export function vatRateOn(rates: readonly VatRate[], isoDate: string): VatRateResult {
  if (!ISO_DATE.test(isoDate)) {
    throw new RangeError(`isoDate must look like YYYY-MM-DD, got "${isoDate}"`);
  }
  const rate = rates.find(
    (r) => r.valid_from <= isoDate && (r.valid_to === null || isoDate <= r.valid_to)
  );
  return rate ? { ok: true, rate } : { ok: false, reason: 'no_rate_on_date' };
}

/**
 * The first rate that starts after `isoDate` and differs from the rate on `isoDate`, or null.
 * Used to warn that invoices will change even though the net rent is locked.
 */
export function nextVatChangeAfter(rates: readonly VatRate[], isoDate: string): VatRate | null {
  const current = vatRateOn(rates, isoDate);
  const later = rates
    .filter((r) => r.valid_from > isoDate)
    .sort((a, b) => a.valid_from.localeCompare(b.valid_from))
    .find((r) => !current.ok || r.rate_percent !== current.rate.rate_percent);
  return later ?? null;
}

/**
 * VAT in cents on `netCents` at `ratePercent` (e.g. 25.5), rounded half up once.
 * 10730 at 25.5 % = 2736.15 → 2736.
 */
export function vatCents(netCents: number, ratePercent: number): number {
  // Rates are given to a tenth of a percent, so 25.5 % is 255 / 1000.
  const rateTenthsOfPercent = toScaledInteger(ratePercent, 10);
  return divideRoundHalfUp(netCents * rateTenthsOfPercent, 1000);
}

/** What a customer needs to know about VAT on `isoDate`: today's rate and the next change. */
export type VatOutlook = {
  /** The rate on `isoDate`, or null when no rate covers that day. */
  currentPercent: number | null;
  /** The next scheduled rate that differs from today's, or null when none is scheduled. */
  next: { ratePercent: number; validFrom: string } | null;
};

/**
 * The VAT rate on `isoDate` and the next scheduled change after it, for the "VAT is added to
 * each invoice" note. Rates come from data/vat-rates.json, so the note never hardcodes them.
 */
export function vatOutlookOn(rates: readonly VatRate[], isoDate: string): VatOutlook {
  const current = vatRateOn(rates, isoDate);
  const next = nextVatChangeAfter(rates, isoDate);
  return {
    currentPercent: current.ok ? current.rate.rate_percent : null,
    next: next ? { ratePercent: next.rate_percent, validFrom: next.valid_from } : null,
  };
}
