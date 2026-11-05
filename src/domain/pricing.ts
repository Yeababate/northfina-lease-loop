import { isoDateSchema } from '@/data/schemas';
import { contractEndOn } from './contract-period';
import type { CoefficientTable, PriceList, VatRates } from '@/data/schemas';
import { monthlyFactorFor } from './coefficient';
import { listPriceOn } from './price-list';

export type PricingInput = { assetId: string; termMonths: number; downPaymentCents: number };

/** Prices become binding on signing, using that day's catalogue and coefficients. */
export function priceContract(
  lists: readonly PriceList[],
  table: CoefficientTable,
  input: PricingInput,
  signedOn: string
) {
  if (!Number.isSafeInteger(input.downPaymentCents)) throw new RangeError('Whole cents required');
  if (input.downPaymentCents < 0) return { ok: false, reason: 'invalid_down_payment' } as const;
  const price = listPriceOn(lists, input.assetId, signedOn);
  if (!price.ok) return price;
  if (table.valid_from > signedOn) return { ok: false, reason: 'no_coefficient_on_date' } as const;
  if (input.downPaymentCents > price.priceCents)
    return { ok: false, reason: 'invalid_down_payment' } as const;
  const financedCents = price.priceCents - input.downPaymentCents;
  const factor = monthlyFactorFor(table, financedCents, input.termMonths);
  if (!factor.ok) return factor;
  const buyoutPercent = table.end_of_term_buyout_percent_of_financed[String(input.termMonths)];
  if (buyoutPercent === undefined) return { ok: false, reason: 'unknown_term' } as const;
  // Round each final net amount once to nearest cent; half cents round up.
  return {
    ok: true,
    price: {
      ...input,
      signedOn,
      endOn: contractEndOn(signedOn, input.termMonths),
      listPriceCents: price.priceCents,
      priceListVersion: price.priceListVersion,
      coefficientVersion: table.version,
      coefficientId: table.id,
      band: factor.band.band,
      factor: factor.factor,
      financedCents,
      monthlyNetCents: Math.round(financedCents * factor.factor),
      buyoutNetCents: Math.round((financedCents * buyoutPercent) / 100),
    },
  } as const;
}

/** Only the stored net rent is used; catalogue prices are never consulted. */
export function invoicePrice(
  contract: { monthlyNetCents: number },
  vat: VatRates,
  invoiceDate: string
) {
  isoDateSchema.parse(invoiceDate);
  if (!Number.isSafeInteger(contract.monthlyNetCents) || contract.monthlyNetCents < 0)
    throw new RangeError('Nonnegative whole cents required');
  const rate = vat.rates.find(
    (r) => r.valid_from <= invoiceDate && (r.valid_to === null || invoiceDate <= r.valid_to)
  );
  if (!rate) return { ok: false, reason: 'no_vat_on_date' } as const;
  // VAT is rounded once per invoice to nearest cent, half up.
  const vatCents = Math.round((contract.monthlyNetCents * rate.rate_percent) / 100);
  return {
    ok: true,
    netCents: contract.monthlyNetCents,
    vatPercent: rate.rate_percent,
    vatCents,
    totalCents: contract.monthlyNetCents + vatCents,
  } as const;
}
