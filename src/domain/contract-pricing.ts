import { isoDateSchema } from '@/data/schemas';
import { contractEndOn } from './contract-period';
import type { CoefficientTable, PriceList, VatRates } from '@/data/schemas';
import { quoteLease } from './pricing';
import { vatCents as calculateVatCents } from './vat';
import { listPriceOn } from './price-list';

export type PricingInput = {
  assetId: string;
  termMonths: number;
  downPaymentCents: number;
  /** First day of the lease. Defaults to the signing day; may not be before it. */
  startOn?: string;
};

/** Prices become binding on signing, using that day's catalogue and coefficients. */
export function priceContract(
  lists: readonly PriceList[],
  table: CoefficientTable,
  input: PricingInput,
  signedOn: string
) {
  if (!Number.isSafeInteger(input.downPaymentCents)) throw new RangeError('Whole cents required');
  if (input.downPaymentCents < 0) return { ok: false, reason: 'invalid_down_payment' } as const;
  const startOn = input.startOn ?? signedOn;
  isoDateSchema.parse(startOn);
  if (startOn < signedOn) return { ok: false, reason: 'start_before_signing' } as const;
  const price = listPriceOn(lists, input.assetId, signedOn);
  if (!price.ok) return price;
  if (table.valid_from > signedOn) return { ok: false, reason: 'no_coefficient_on_date' } as const;
  if (input.downPaymentCents > price.priceCents)
    return { ok: false, reason: 'invalid_down_payment' } as const;
  if (table.end_of_term_buyout_percent_of_financed[String(input.termMonths)] === undefined)
    return { ok: false, reason: 'unknown_term' } as const;
  const result = quoteLease(table, {
    listPriceCents: price.priceCents,
    downPaymentCents: input.downPaymentCents,
    termMonths: input.termMonths,
    // Only net amounts are persisted. VAT is selected separately for each invoice date.
    vatRatePercent: 0,
  });
  if (!result.ok) return result;
  const quote = result.quote;
  return {
    ok: true,
    price: {
      ...input,
      signedOn,
      startOn,
      endOn: contractEndOn(startOn, input.termMonths),
      listPriceCents: price.priceCents,
      priceListVersion: price.priceListVersion,
      coefficientVersion: table.version,
      coefficientId: table.id,
      band: quote.band.band,
      factor: quote.factor,
      financedCents: quote.financedCents,
      monthlyNetCents: quote.monthlyNetCents,
      buyoutNetCents: quote.buyoutCents,
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
  const vatCents = calculateVatCents(contract.monthlyNetCents, rate.rate_percent);
  return {
    ok: true,
    netCents: contract.monthlyNetCents,
    vatPercent: rate.rate_percent,
    vatCents,
    totalCents: contract.monthlyNetCents + vatCents,
  } as const;
}
