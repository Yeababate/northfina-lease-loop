import { beforeAll, expect, it } from 'vitest';
import { loadVatRates } from '@/data/load';
import { calculateInvoices, invoiceSchedule } from './invoices';

let vat: Awaited<ReturnType<typeof loadVatRates>>;
beforeAll(async () => {
  vat = await loadVatRates();
});

it('bills from the saved lease start rather than an earlier signing date', () => {
  const result = calculateInvoices(
    {
      signedOn: '2026-11-05',
      startOn: '2027-01-31',
      termMonths: 36,
      monthlyNetCents: 10730,
    },
    vat
  );
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error('Pricing failed');
  expect(result.invoices[0]).toMatchObject({
    invoiceDate: '2027-01-31',
    dueDate: '2027-01-31',
    vatPercent: 26,
  });
  expect(result.invoices[1]?.invoiceDate).toBe('2027-02-28');
  expect(result.invoices[13]?.invoiceDate).toBe('2028-02-29');
  expect(result.invoices[14]?.invoiceDate).toBe('2028-03-31');
  expect(result.invoices).toHaveLength(36);
});

it('anchors short months independently, including leap years', () => {
  const dates = invoiceSchedule('2026-01-31', 36);
  expect(dates).toHaveLength(36);
  expect(dates[1]).toMatchObject({ invoiceDate: '2026-02-28', dueDate: '2026-02-28' });
  expect(dates[2]?.invoiceDate).toBe('2026-03-31');
  expect(dates[25]?.invoiceDate).toBe('2028-02-29');
  expect(dates[26]?.invoiceDate).toBe('2028-03-31');
});

it('bills mid-month starts in advance without an extra or prorated invoice', () => {
  const result = calculateInvoices(
    { signedOn: '2026-09-15', termMonths: 24, monthlyNetCents: 10730 },
    vat
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Pricing failed');
  expect(result.invoices).toHaveLength(24);
  expect(result.invoices[0]?.invoiceDate).toBe('2026-09-15');
  expect(result.invoices[23]?.invoiceDate).toBe('2028-08-15');
  expect(result.invoices[3]).toMatchObject({
    invoiceDate: '2026-12-15',
    netCents: 10730,
    vatPercent: 25.5,
    vatCents: 2736,
    grossCents: 13466,
  });
  expect(result.invoices[4]).toMatchObject({
    invoiceDate: '2027-01-15',
    netCents: 10730,
    vatPercent: 26,
    vatCents: 2790,
    grossCents: 13520,
  });
  expect(result.invoices.reduce((sum, row) => sum + row.netCents, 0)).toBe(24 * 10730);
  expect(result.invoices.reduce((sum, row) => sum + row.grossCents, 0)).toBe(
    result.invoices.reduce((sum, row) => sum + row.netCents + row.vatCents, 0)
  );
});

it('uses invoice-date VAT boundaries, rounds half cents and supports zero rent', () => {
  for (const [signedOn, vatPercent] of [
    ['2026-12-31', 25.5],
    ['2027-01-01', 26],
  ] as const) {
    expect(calculateInvoices({ signedOn, termMonths: 1, monthlyNetCents: 100 }, vat)).toMatchObject(
      { ok: true, invoices: [{ vatPercent, vatCents: 26 }] }
    );
  }
  expect(
    calculateInvoices({ signedOn: '2026-11-05', termMonths: 1, monthlyNetCents: 0 }, vat)
  ).toMatchObject({ ok: true, invoices: [{ grossCents: 0 }] });
  expect(
    calculateInvoices(
      { signedOn: '2026-11-05', termMonths: 2, monthlyNetCents: 100 },
      { ...vat, rates: [] }
    )
  ).toEqual({ ok: false, reason: 'no_vat_on_date' });
});

it('rejects invalid dates, terms and fractional cents', () => {
  expect(() => invoiceSchedule('2026-02-30', 12)).toThrow();
  for (const term of [0, -1, 1.5, 49, NaN])
    expect(() => invoiceSchedule('2026-01-01', term)).toThrow();
  for (const monthlyNetCents of [-1, 0.5])
    expect(() =>
      calculateInvoices({ signedOn: '2026-01-01', termMonths: 12, monthlyNetCents }, vat)
    ).toThrow();
});
