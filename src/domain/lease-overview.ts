// What the "My leases" card shows about one signed lease: which month it is in, the next
// invoice and the last day. Pure: "today" and the VAT table are passed in.
import type { VatRates } from '@/data/schemas';
import { invoicePrice } from './contract-pricing';
import { invoiceSchedule } from './invoices';
import { isIsoDate } from './iso-date';
import { divideRoundHalfUp } from './rounding';

export type OverviewContract = {
  startOn: string;
  termMonths: number;
  monthlyNetCents: number;
};

/**
 * The lease month `today` falls in, counting from 1. A month starts on its invoice date
 * (billing is monthly in advance), so the start date is month 1. Before the start it is 0;
 * after the last month it stays at the term length.
 */
export function leaseMonthOn(contract: OverviewContract, today: string): number {
  return invoiceSchedule(contract.startOn, contract.termMonths).filter(
    (row) => row.invoiceDate <= today
  ).length;
}

/**
 * The next invoice on or after `today`, priced with the VAT rate on its own date (the net
 * rent is locked; VAT follows the invoice date). Null when no invoices are left, or when no
 * VAT rate covers that date yet.
 */
export function nextInvoiceOn(
  contract: OverviewContract,
  vat: VatRates,
  today: string
): { invoiceDate: string; grossCents: number } | null {
  const next = invoiceSchedule(contract.startOn, contract.termMonths).find(
    (row) => row.invoiceDate >= today
  );
  if (!next) return null;
  const price = invoicePrice(contract, vat, next.invoiceDate);
  return price.ok ? { invoiceDate: next.invoiceDate, grossCents: price.totalCents } : null;
}

/** The day before an ISO date. Contract end dates are exclusive, so this is the last day. */
export function previousDay(isoDate: string): string {
  if (!isIsoDate(isoDate)) throw new RangeError(`previousDay needs an ISO date, got "${isoDate}"`);
  const [year = 0, month = 0, day = 0] = isoDate.split('-').map(Number);
  if (day > 1) return format(year, month, day - 1);
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return format(prevYear, prevMonth, daysIn(prevYear, prevMonth));
}

/**
 * Grams to whole kilograms for display, rounded once, half away from zero (so a negative
 * estimate, an additional impact, rounds the same way as a saving).
 */
export function wholeKilograms(grams: number): number {
  if (!Number.isSafeInteger(grams)) throw new RangeError('Whole grams required');
  const kg = divideRoundHalfUp(Math.abs(grams), 1000);
  return grams < 0 && kg !== 0 ? -kg : kg;
}

function daysIn(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (month === 2) return leap ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function format(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
