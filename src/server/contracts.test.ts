import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/contracts/route';
import { loadAssets, loadCoefficientTable, loadPriceLists } from '@/data/load';
import { priceContract } from '@/domain/pricing';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { signContract } from './contracts';
import type { PrismaClient } from './prisma-client';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
vi.mock('@/server/today', () => ({ todayIso: () => '2026-11-05' }));

let db: PrismaClient;
let cleanup: () => Promise<void>;
let lists: Awaited<ReturnType<typeof loadPriceLists>>;
let table: Awaited<ReturnType<typeof loadCoefficientTable>>;
const input = {
  assetId: 'ebike-003',
  actor: 'cust-aino',
  termMonths: 36,
  downPaymentCents: 0,
  expectedMonthlyNetCents: 10730,
  expectedPriceListVersion: 1,
};
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  [lists, table] = await Promise.all([loadPriceLists(), loadCoefficientTable()]);
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.contract.deleteMany();
  await db.auditLog.deleteMany();
  await db.asset.deleteMany();
  await seedAssets(db, await loadAssets());
  await db.auditLog.deleteMany();
});
it('persists the full snapshot and audit, reserves the item and rejects repeat signing', async () => {
  const contract = await signContract(db, input, '2026-11-05', lists, table);
  expect(contract).toMatchObject({
    monthlyNetCents: 10730,
    buyoutNetCents: 58350,
    signedOn: '2026-11-05',
    endOn: '2029-11-05',
    actor: 'cust-aino',
  });
  expect(await db.asset.findUnique({ where: { id: input.assetId } })).toMatchObject({
    status: 'reserved',
  });
  const audit = await db.auditLog.findFirstOrThrow();
  expect(audit).toMatchObject({
    action: 'contract.signed',
    entity_id: contract.id,
    actor: input.actor,
  });
  expect(JSON.parse(audit.details_json!)).toMatchObject({
    monthlyNetCents: 10730,
    priceListVersion: 1,
  });
  await expect(signContract(db, input, '2026-11-05', lists, table)).rejects.toMatchObject({
    code: 'ASSET_UNAVAILABLE',
  });
  expect(await db.contract.count()).toBe(1);
  expect(await db.auditLog.count()).toBe(1);
});
it('reads the same stored price after both catalogue and coefficient changes', async () => {
  const contract = await signContract(db, input, '2026-11-05', lists, table);
  const changed = structuredClone(lists);
  changed[0]!.prices[input.assetId] = 500000;
  const changedTable = structuredClone(table);
  changedTable.bands[1]!.monthly_factor_by_term['36'] = 0.05;
  expect(priceContract(changed, changedTable, input, '2026-11-05')).toMatchObject({
    ok: true,
    price: { monthlyNetCents: 25000 },
  });
  expect(await db.contract.findUnique({ where: { id: contract.id } })).toEqual(contract);
});
it('requires renewed consent for a stale quote on the next day', async () => {
  await expect(signContract(db, input, '2026-11-06', lists, table)).rejects.toMatchObject({
    code: 'PRICE_CHANGED',
  });
  expect(await db.contract.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
});
it('rejects invalid pricing and unknown assets without writes', async () => {
  await expect(
    signContract(db, { ...input, downPaymentCents: -1 }, '2026-11-05', lists, table)
  ).rejects.toMatchObject({ code: 'INVALID_PRICE' });
  const withMissing = structuredClone(lists);
  withMissing[0]!.prices.missing = 389000;
  await expect(
    signContract(db, { ...input, assetId: 'missing' }, '2026-11-05', withMissing, table)
  ).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  expect(await db.auditLog.count()).toBe(0);
});
it('rolls back contract and reservation if the audit insert fails', async () => {
  // A transaction client uses the same model extension as the outer client.
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
    signContract(failingDb as unknown as PrismaClient, input, '2026-11-05', lists, table)
  ).rejects.toThrow('audit unavailable');
  expect(await db.contract.count()).toBe(0);
  expect(await db.asset.findUnique({ where: { id: input.assetId } })).toMatchObject({
    status: 'available',
  });
  expect(await db.auditLog.count()).toBe(0);
});

it('signing API validates input and returns the shared response envelope', async () => {
  const request = (body: unknown) =>
    new Request('http://localhost/api/contracts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const invalid = await POST(request({ ...input, signedOn: '2026-11-06' }), undefined);
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({
    success: false,
    error: { code: 'VALIDATION_ERROR' },
  });
  const fractional = await POST(request({ ...input, downPaymentCents: 0.5 }), undefined);
  expect(fractional.status).toBe(400);
  const signed = await POST(request(input), undefined);
  expect(signed.status).toBe(201);
  expect(await signed.json()).toMatchObject({
    success: true,
    data: { monthlyNetCents: 10730, signedOn: '2026-11-05' },
    meta: { timestamp: expect.any(String) },
  });
  const duplicate = await POST(request(input), undefined);
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toMatchObject({
    success: false,
    error: { code: 'ASSET_UNAVAILABLE' },
  });
});
