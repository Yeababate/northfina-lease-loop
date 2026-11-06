import { expect, it } from 'vitest';
import { generateInvoices } from '@/server/invoices';
import { signAino, withScenario } from './fixtures';

it('card 4: a January 31 lease clamps both February due dates and restores March 31', async () => {
  await withScenario(async (db, data) => {
    const contract = await signAino(db, data, 'laptop-001', '2026-01-31');
    const invoices = await generateInvoices(db, contract.id, 'cust-aino', data.vatRates);
    expect(invoices[1]).toMatchObject({ invoiceDate: '2026-02-28', dueDate: '2026-02-28' });
    expect(invoices[2]).toMatchObject({ invoiceDate: '2026-03-31', dueDate: '2026-03-31' });
    expect(invoices[25]).toMatchObject({ invoiceDate: '2028-02-29', dueDate: '2028-02-29' });
  });
});
