import { describe, expect, it } from 'vitest';
import { leaseMonthOn, nextInvoiceOn, previousDay, wholeKilograms } from './lease-overview';

const lease = { startOn: '2026-11-05', termMonths: 12, monthlyNetCents: 10730 };
const vat = {
  country: 'FI',
  note: 'test rates',
  rates: [
    { rate_percent: 25.5, valid_from: '2024-09-01', valid_to: '2026-12-31' },
    { rate_percent: 26, valid_from: '2027-01-01', valid_to: null },
  ],
};

describe('leaseMonthOn', () => {
  it('is 0 before the start and 1 on the start day', () => {
    expect(leaseMonthOn(lease, '2026-11-04')).toBe(0);
    expect(leaseMonthOn(lease, '2026-11-05')).toBe(1);
  });

  it('moves to the next month on each invoice date', () => {
    expect(leaseMonthOn(lease, '2026-12-04')).toBe(1);
    expect(leaseMonthOn(lease, '2026-12-05')).toBe(2);
  });

  it('stays at the term length after the end', () => {
    expect(leaseMonthOn(lease, '2030-01-01')).toBe(12);
  });
});

describe('nextInvoiceOn', () => {
  it('is today when an invoice falls today', () => {
    expect(nextInvoiceOn(lease, vat, '2026-11-05')).toEqual({
      invoiceDate: '2026-11-05',
      grossCents: 13466,
    });
  });

  it('uses the VAT rate on the invoice date, not today', () => {
    // Asked in December 2026; the next invoice is in January 2027 at 26 %.
    expect(nextInvoiceOn(lease, vat, '2026-12-06')).toEqual({
      invoiceDate: '2027-01-05',
      grossCents: 10730 + 2790,
    });
  });

  it('is null after the last invoice', () => {
    expect(nextInvoiceOn(lease, vat, '2027-10-06')).toBeNull();
  });

  it('is null when no VAT rate covers the date', () => {
    expect(nextInvoiceOn(lease, { ...vat, rates: [] }, '2026-11-05')).toBeNull();
  });
});

describe('previousDay', () => {
  it('steps back within a month, across months, years and leap days', () => {
    expect(previousDay('2027-11-05')).toBe('2027-11-04');
    expect(previousDay('2027-03-01')).toBe('2027-02-28');
    expect(previousDay('2028-03-01')).toBe('2028-02-29');
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
    expect(previousDay('2027-05-01')).toBe('2027-04-30');
  });

  it('rejects text that is not a calendar date', () => {
    expect(() => previousDay('2027-02-30')).toThrow(RangeError);
  });
});

describe('wholeKilograms', () => {
  it('rounds half up, away from zero for negatives', () => {
    expect(wholeKilograms(0)).toBe(0);
    expect(wholeKilograms(1499)).toBe(1);
    expect(wholeKilograms(1500)).toBe(2);
    expect(wholeKilograms(-1500)).toBe(-2);
    expect(wholeKilograms(-400)).toBe(0);
  });

  it('rejects fractional grams', () => {
    expect(() => wholeKilograms(1.5)).toThrow(RangeError);
  });
});
