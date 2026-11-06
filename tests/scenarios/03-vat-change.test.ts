import { expect, it } from 'vitest';
import { generateInvoices } from '@/server/invoices';
import { signAino, withScenario } from './fixtures';

it('card 3: January VAT changes while the locked net rent stays the same', async () => {
  await withScenario(async (db, data) => {
    const contract = await signAino(db, data, 'ebike-001', '2026-09-15', 24);
    const invoices = await generateInvoices(db, contract.id, 'cust-aino', data.vatRates);
    const december = invoices.find((invoice) => invoice.invoiceDate === '2026-12-15');
    const january = invoices.find((invoice) => invoice.invoiceDate === '2027-01-15');
    expect(december).toMatchObject({ netCents: contract.monthlyNetCents, vatPercent: 25.5 });
    expect(january).toMatchObject({ netCents: contract.monthlyNetCents, vatPercent: 26 });
    expect(january!.grossCents).toBeGreaterThan(december!.grossCents);
  });
});
