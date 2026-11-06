import { isoDateSchema, type VatRates } from '@/data/schemas';
import { contractEndOn } from './contract-period';
import { invoicePrice } from './contract-pricing';

export type RentalContract = {
  signedOn: string;
  startOn?: string;
  termMonths: number;
  monthlyNetCents: number;
};

/** Advance billing: first invoice and payment due on lease start; no proration. */
export function invoiceSchedule(signedOn: string, termMonths: number) {
  isoDateSchema.parse(signedOn);
  if (!Number.isSafeInteger(termMonths) || termMonths < 1 || termMonths > 48)
    throw new RangeError('Term must be between 1 and 48 months');
  return Array.from({ length: termMonths }, (_, index) => {
    // Always calculate from the original day, never from the previous clamped date.
    const invoiceDate = index === 0 ? signedOn : contractEndOn(signedOn, index);
    isoDateSchema.parse(invoiceDate);
    return { period: index + 1, invoiceDate, dueDate: invoiceDate };
  });
}

/**
 * Locked net rent only. VAT is rounded half up once per invoice by invoicePrice.
 * A returned lease's cash total is its down payment plus these gross invoice rows; add a
 * separately paid buyout only if exercised. Keep each row's net and VAT split once.
 */
export function calculateInvoices(contract: RentalContract, vat: VatRates) {
  const schedule = invoiceSchedule(contract.startOn ?? contract.signedOn, contract.termMonths);
  const invoices = [];
  for (const date of schedule) {
    const price = invoicePrice(contract, vat, date.invoiceDate);
    if (!price.ok) return price;
    invoices.push({
      ...date,
      netCents: price.netCents,
      vatPercent: price.vatPercent,
      vatCents: price.vatCents,
      grossCents: price.totalCents,
    });
  }
  return { ok: true, invoices } as const;
}
