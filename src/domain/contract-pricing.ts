import { isoDateSchema } from '@/data/schemas';
import { contractEndOn } from './contract-period';
import type { CoefficientTable, PriceList, VatRates } from '@/data/schemas';
import type { RentalDiscountRule } from './discounts';
import { quoteLease } from './pricing';
import { vatCents as calculateVatCents } from './vat';
import { listPriceOn } from './price-list';

export type PricingInput = {
  assetId: string;
  termMonths: number;
  downPaymentCents: number;
  /** First day of the lease. Defaults to the signing day; may not be before it. */
  startOn?: string;
  /**
   * How many of this item, leased together (a fleet, e.g. 4 × ebike-004). The list price,
   * down payment, financed amount, rent and buyout are all for the whole lot: the band and
   * the eligibility rules see the total. Defaults to 1.
   */
  quantity?: number;
};

/** The most units one application can lease. */
export const MAX_QUANTITY = 10;

/** Prices become binding on signing, using that day's catalogue and coefficients. */
export function priceContract(
  lists: readonly PriceList[],
  table: CoefficientTable,
  input: PricingInput,
  signedOn: string,
  discountRules: readonly RentalDiscountRule[] = []
) {
  if (!Number.isSafeInteger(input.downPaymentCents)) throw new RangeError('Whole cents required');
  if (input.downPaymentCents < 0) return { ok: false, reason: 'invalid_down_payment' } as const;
  const startOn = input.startOn ?? signedOn;
  isoDateSchema.parse(startOn);
  if (startOn < signedOn) return { ok: false, reason: 'start_before_signing' } as const;
  const quantity = input.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY)
    return { ok: false, reason: 'invalid_quantity' } as const;
  const unit = listPriceOn(lists, input.assetId, signedOn);
  if (!unit.ok) return unit;
  // The whole lot is one lease: every amount below is for `quantity` units together.
  const price = { ...unit, priceCents: unit.priceCents * quantity };
  if (table.valid_from > signedOn) return { ok: false, reason: 'no_coefficient_on_date' } as const;
  if (input.downPaymentCents > price.priceCents)
    return { ok: false, reason: 'invalid_down_payment' } as const;
  if (table.end_of_term_buyout_percent_of_financed[String(input.termMonths)] === undefined)
    return { ok: false, reason: 'unknown_term' } as const;
  const result = quoteLease(
    table,
    {
      listPriceCents: price.priceCents,
      downPaymentCents: input.downPaymentCents,
      termMonths: input.termMonths,
      // Only net amounts are persisted. VAT is selected separately for each invoice date.
      vatRatePercent: 0,
    },
    discountRules
  );
  if (!result.ok) return result;
  const quote = result.quote;
  return {
    ok: true,
    price: {
      ...input,
      quantity,
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
      originalMonthlyNetCents: quote.originalMonthlyNetCents,
      monthlyDiscountCents: quote.monthlyDiscountCents,
      discountBps: quote.discountBps,
      discountRuleId: quote.discountRuleId,
      discountRuleRevision: quote.discountRuleRevision,
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

/** Reads `?qty=` from the address: a whole number from 1 to MAX_QUANTITY, otherwise 1. */
export function parseQuantity(value: unknown): number {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,2}$/.test(text)) return 1;
  const quantity = Number(text);
  return quantity >= 1 && quantity <= MAX_QUANTITY ? quantity : 1;
}
