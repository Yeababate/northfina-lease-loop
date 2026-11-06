import { expect, it } from 'vitest';
import { generateInvoices } from '@/server/invoices';
import { signAino, withScenario } from './fixtures';

it('card 1: locks Aino’s 36-month lease and produces the first invoices and exact total', async () => {
  await withScenario(async (db, data) => {
    const contract = await signAino(db, data);
    expect(contract).toMatchObject({
      renterId: 'cust-aino',
      assetId: 'ebike-003',
      monthlyNetCents: 10_730,
      downPaymentCents: 0,
    });
    const invoices = await generateInvoices(db, contract.id, 'cust-aino', data.vatRates);
    expect(invoices).toHaveLength(36);
    expect(invoices.slice(0, 3)).toMatchObject([
      { invoiceDate: '2026-11-05', netCents: 10_730, grossCents: 13_466 },
      { invoiceDate: '2026-12-05', netCents: 10_730, grossCents: 13_466 },
      { invoiceDate: '2027-01-05', netCents: 10_730, grossCents: 13_520 },
    ]);
    expect(invoices.reduce((sum, invoice) => sum + invoice.netCents, 0)).toBe(386_280);
    expect(invoices.reduce((sum, invoice) => sum + invoice.grossCents, 0)).toBe(486_612);
  });
});
