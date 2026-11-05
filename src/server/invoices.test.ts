import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/contracts/[id]/invoices/route';
import { loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
import { priceContract } from '@/domain/contract-pricing';
import { createTestDb } from '../../tests/helpers/test-db';
import { generateInvoices, listInvoices } from './invoices';
import type { PrismaClient } from './prisma-client';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
let db: PrismaClient;
let cleanup: () => Promise<void>;
let vat: Awaited<ReturnType<typeof loadVatRates>>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  vat = await loadVatRates();
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.invoice.deleteMany();
  await db.contract.deleteMany();
  await db.auditLog.deleteMany();
  const [lists, table] = await Promise.all([loadPriceLists(), loadCoefficientTable()]);
  const result = priceContract(
    lists,
    table,
    { assetId: 'ebike-003', termMonths: 36, downPaymentCents: 0 },
    '2026-11-05'
  );
  if (!result.ok) throw new Error('Fixture failed');
  await db.contract.create({ data: { id: 'contract-1', actor: 'cust-aino', ...result.price } });
});

it('persists locked rental amounts and VAT snapshots with an audit entry', async () => {
  const rows = await generateInvoices(db, 'contract-1', 'cust-aino', vat);
  expect(rows).toHaveLength(36);
  expect(rows[0]).toMatchObject({
    period: 1,
    invoiceDate: '2026-11-05',
    dueDate: '2026-11-05',
    netCents: 10730,
    vatCents: 2736,
    grossCents: 13466,
  });
  expect(rows[2]).toMatchObject({
    invoiceDate: '2027-01-05',
    netCents: 10730,
    vatCents: 2790,
    grossCents: 13520,
  });
  expect(await listInvoices(db, 'contract-1')).toEqual(rows);
  expect(await db.auditLog.findFirst()).toMatchObject({
    action: 'invoices.generated',
    actor: 'cust-aino',
    entity_id: 'contract-1',
  });
});

it('repeated and concurrent requests return the same rows without duplicates', async () => {
  const results = await Promise.all([
    generateInvoices(db, 'contract-1', 'cust-aino', vat),
    generateInvoices(db, 'contract-1', 'cust-aino', vat),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(await db.invoice.count()).toBe(36);
  expect(await db.auditLog.count()).toBe(2);
  // Even a changed VAT table cannot overwrite issued amounts.
  expect(await generateInvoices(db, 'contract-1', 'cust-aino', { ...vat, rates: [] })).toEqual(
    results[0]
  );
  await expect(
    db.invoice.create({ data: { ...results[0]![0]!, id: 'duplicate' } })
  ).rejects.toMatchObject({ code: 'P2002' });
});

it('uses only the persisted rent even when the original pricing inputs are unavailable', async () => {
  // Represent an old saved snapshot with a coefficient/list version absent from current data.
  await db.contract.update({
    where: { id: 'contract-1' },
    data: { monthlyNetCents: 12345, coefficientId: 'retired', priceListVersion: 999 },
  });
  const rows = await generateInvoices(db, 'contract-1', 'cust-aino', vat);
  expect(rows.every((row) => row.netCents === 12345)).toBe(true);
  expect(rows.reduce((sum, row) => sum + row.netCents, 0)).toBe(12345 * 36);
});

it('rolls back every invoice when the audit insert fails', async () => {
  const failingDb = db.$extends({
    query: {
      auditLog: {
        create() {
          throw new Error('audit unavailable');
        },
      },
    },
  });
  await expect(
    generateInvoices(failingDb as unknown as PrismaClient, 'contract-1', 'cust-aino', vat)
  ).rejects.toThrow('audit unavailable');
  expect(await db.invoice.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
});

it('fails atomically for missing VAT or contract', async () => {
  await expect(
    generateInvoices(db, 'contract-1', 'cust-aino', { ...vat, rates: [] })
  ).rejects.toMatchObject({ code: 'VAT_UNAVAILABLE' });
  await expect(generateInvoices(db, 'missing', 'cust-aino', vat)).rejects.toMatchObject({
    code: 'CONTRACT_NOT_FOUND',
  });
  await expect(listInvoices(db, 'missing')).rejects.toMatchObject({ code: 'CONTRACT_NOT_FOUND' });
  expect(await db.invoice.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
});

it('API lists without writes, validates actors and generates using the shared envelope', async () => {
  const context = { params: Promise.resolve({ id: 'contract-1' }) };
  const request = (body: unknown) =>
    new Request('http://localhost/api/contracts/contract-1/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const empty = await GET(request({}), context);
  expect(await empty.json()).toMatchObject({ success: true, data: [] });
  expect(await db.auditLog.count()).toBe(0);
  expect((await POST(request({ actor: '' }), context)).status).toBe(400);
  expect((await POST(request({ actor: 'cust-aino', monthlyNetCents: 1 }), context)).status).toBe(
    400
  );
  const issued = await POST(request({ actor: 'cust-aino' }), context);
  expect(issued.status).toBe(200);
  expect(await issued.json()).toMatchObject({
    success: true,
    data: expect.arrayContaining([expect.objectContaining({ netCents: 10730 })]),
    meta: { timestamp: expect.any(String) },
  });
  const listed = await GET(request({}), context);
  expect((await listed.json()).data).toHaveLength(36);
  expect((await GET(request({}), { params: Promise.resolve({ id: 'missing' }) })).status).toBe(404);
});
