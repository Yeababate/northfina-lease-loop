import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { loadAssets, loadCoefficientTable, loadPriceLists } from '@/data/load';
import { priceContract } from '@/domain/contract-pricing';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { signContract } from './contracts';
import {
  finalizeDueReturns,
  recordInspection,
  recordReceipt,
  recordWork,
  relist,
} from './next-life-commands';
import type { PrismaClient } from './prisma-client';
import { seedDealerSide } from './providers';
let db: PrismaClient;
let cleanup: () => Promise<void>;
const KETTU = 'provider-kettu';
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.returnIntake.deleteMany();
  await db.contract.deleteMany();
  await db.auditLog.deleteMany();
  await db.asset.deleteMany();
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await seedDealerSide(db, assets);
});
async function ready() {
  await recordInspection(
    db,
    KETTU,
    'seed-ebike-008',
    { expectedRevision: 0, condition: 'good', usageValue: 9800, hoursSinceService: null },
    '2026-11-05'
  );
  return (
    await recordWork(
      db,
      KETTU,
      'seed-ebike-008',
      { expectedRevision: 1, actionId: 'safety_inspection' },
      '2026-11-05'
    )
  ).revision;
}
async function signEbike() {
  const [lists, table] = await Promise.all([loadPriceLists(), loadCoefficientTable()]);
  const input = { assetId: 'ebike-003', termMonths: 12, downPaymentCents: 0 };
  const result = priceContract(lists, table, input, '2026-11-05');
  if (!result.ok) throw new Error('Expected a priceable fixture');
  return signContract(
    db,
    {
      ...input,
      actor: 'Aino',
      expectedMonthlyNetCents: result.price.monthlyNetCents,
      expectedBuyoutNetCents: result.price.buyoutNetCents,
      expectedPriceListVersion: 1,
    },
    '2026-11-05',
    lists,
    table
  );
}
it('rolls back relisting when valuation is below the finance floor', async () => {
  const revision = await ready();
  const unpriceable = db.$extends({
    query: { contract: { findFirst: async () => ({ startOn: '2020-01-01', listPriceCents: 1 }) } },
  }) as unknown as PrismaClient;
  await expect(
    relist(unpriceable, KETTU, 'seed-ebike-008', { expectedRevision: revision }, '2026-11-05')
  ).rejects.toMatchObject({ code: 'INVALID_NEXT_LIFE_PRICE' });
  expect(await db.returnIntake.findUnique({ where: { id: 'seed-ebike-008' } })).toMatchObject({
    revision,
    relistedOn: null,
  });
  expect(await db.asset.findUnique({ where: { id: 'ebike-008' } })).toMatchObject({
    status: 'returned',
    nextLifePriceCents: null,
  });
});

it('rolls back relisting when another reservation wins its final guarded update', async () => {
  const revision = await ready();
  const racing = db.$extends({
    query: { asset: { updateMany: async () => ({ count: 0 }) } },
  }) as unknown as PrismaClient;
  await expect(
    relist(racing, KETTU, 'seed-ebike-008', { expectedRevision: revision }, '2026-11-05')
  ).rejects.toMatchObject({ code: 'ASSET_NOT_RETURNED' });
  expect(await db.returnIntake.findUnique({ where: { id: 'seed-ebike-008' } })).toMatchObject({
    revision,
    relistedOn: null,
  });
  expect(await db.auditLog.count({ where: { action: 'return.relisted' } })).toBe(0);
});

it('does not receive an item when the guarded stock update loses a race', async () => {
  const contract = await signEbike();
  const racing = db.$extends({
    query: { asset: { updateMany: async () => ({ count: 0 }) } },
  }) as unknown as PrismaClient;
  await expect(recordReceipt(racing, KETTU, contract.id, '2026-11-06')).rejects.toMatchObject({
    code: 'ASSET_NOT_LEASED',
  });
  expect(await db.returnIntake.count({ where: { contractId: contract.id } })).toBe(0);
  expect(await db.auditLog.count({ where: { action: 'return.received' } })).toBe(0);
});

it('does not count a life while a different ending is pending or completion loses its claim', async () => {
  const contract = await signEbike();
  await recordReceipt(db, KETTU, contract.id, '2026-11-06');
  await db.endTermChoice.create({
    data: { contractId: contract.id, kind: 'end_buyout', requestedOn: '2027-10-30' },
  });
  expect(await finalizeDueReturns(db, contract.endOn)).toBe(0);
  await db.endTermChoice.delete({ where: { contractId: contract.id } });
  const racing = db.$extends({
    query: { returnIntake: { updateMany: async () => ({ count: 0 }) } },
  }) as unknown as PrismaClient;
  expect(await finalizeDueReturns(racing, contract.endOn)).toBe(0);
  expect(await db.asset.findUnique({ where: { id: contract.assetId } })).toMatchObject({
    previous_lives: 0,
  });
  expect(await finalizeDueReturns(db, contract.endOn)).toBe(1);
});
