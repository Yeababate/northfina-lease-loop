import type { CoefficientTable, PriceList, VatRates } from '@/data/schemas';
import { invoicePrice, priceContract, type PricingInput } from './contract-pricing';

/** One explanation for the exact condition that prevents signing. */
export function contractSigningState(
  lists: readonly PriceList[],
  table: CoefficientTable,
  vat: VatRates,
  input: PricingInput,
  signedOn: string,
  actor: string,
  busy: boolean
) {
  const quote = Number.isSafeInteger(input.downPaymentCents)
    ? priceContract(lists, table, input, signedOn)
    : { ok: false as const, reason: 'invalid_down_payment' as const };
  const tax = quote.ok ? invoicePrice(quote.price, vat, signedOn) : null;
  const reason = busy
    ? 'busy'
    : !quote.ok
      ? quote.reason
      : !tax?.ok
        ? 'no_vat_on_date'
        : actor.trim().length === 0 || actor.trim().length > 100
          ? 'actor_required'
          : null;
  return { quote, tax, reason, canSign: reason === null } as const;
}
