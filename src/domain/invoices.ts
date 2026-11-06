import { isoDateSchema, type VatRates } from '@/data/schemas';
import { contractEndOn } from './contract-period';
import { invoicePrice } from './contract-pricing';
import { vatCents as vatOnCents } from './vat';

export type RentalContract = {
  signedOn: string;
  startOn?: string;
  termMonths: number;
  monthlyNetCents: number;
};

export type InvoiceSnapshot = {
  invoiceDate: string;
  netCents: number;
  vatPercent: number;
  vatCents: number;
  grossCents: number;
};

/** Explains a saved invoice change only when unchanged net and saved VAT arithmetic prove it. */
export function explainInvoiceChange(previous: InvoiceSnapshot, invoice: InvoiceSnapshot) {
  isoDateSchema.parse(previous.invoiceDate);
  isoDateSchema.parse(invoice.invoiceDate);
  if (
    invoice.invoiceDate <= previous.invoiceDate ||
    previous.netCents !== invoice.netCents ||
    previous.grossCents === invoice.grossCents ||
    previous.vatPercent === invoice.vatPercent ||
    previous.grossCents !== previous.netCents + previous.vatCents ||
    invoice.grossCents !== invoice.netCents + invoice.vatCents ||
    previous.vatCents !== vatOnCents(previous.netCents, previous.vatPercent) ||
    invoice.vatCents !== vatOnCents(invoice.netCents, invoice.vatPercent)
  )
    return null;
  return {
    reason: 'vat_rate_changed' as const,
    oldVatPercent: previous.vatPercent,
    newVatPercent: invoice.vatPercent,
    differenceCents: Math.abs(invoice.grossCents - previous.grossCents),
  };
}

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
