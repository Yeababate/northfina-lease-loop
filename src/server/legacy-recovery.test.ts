import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { loadAssets, loadCoefficientTable, loadPriceLists } from '@/data/load';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { signContract } from './contracts';
import { seedDemoParticipants } from './demo-participants';
import { restoreParticipantsFromSigningRecords, backfillLegacyLines } from './legacy-contracts';
import type { PrismaClient } from './prisma-client';
import { seedDealerSide } from './providers';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let contractId: string;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.contract.deleteMany();
  await db.auditLog.deleteMany();
  await db.asset.deleteMany();
  await db.demoUser.deleteMany();
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await seedDealerSide(db, assets);
  await seedDemoParticipants(db);
  const [lists, table] = await Promise.all([loadPriceLists(), loadCoefficientTable()]);
  const signed = await signContract(
    db,
    {
      assetId: 'ebike-003',
      actor: 'cust-aino',
      termMonths: 36,
      downPaymentCents: 0,
      expectedMonthlyNetCents: 10730,
      expectedBuyoutNetCents: 58350,
      expectedPriceListVersion: 1,
    },
    '2026-11-05',
    lists,
    table
  );
  contractId = signed.id;
});

it.each(['audit', 'provider-link', 'known-renter', 'provider-account', 'provider-record'])(
  'does not guess participants when %s evidence is missing',
  async (missing) => {
    if (missing === 'audit') await db.auditLog.deleteMany({ where: { entity_id: contractId } });
    if (missing === 'provider-link') await db.contractProvider.deleteMany();
    if (missing === 'known-renter')
      await db.auditLog.updateMany({
        where: { entity_id: contractId },
        data: { actor: 'Aino Virtanen' },
      });
    if (missing === 'provider-account')
      await db.demoUser.delete({ where: { id: 'provider-kettu' } });
    if (missing === 'provider-record')
      await db.provider.delete({ where: { id: 'provider-kettu' } });
    expect(await restoreParticipantsFromSigningRecords(db)).toBe(0);
    expect(await db.contract.findUnique({ where: { id: contractId } })).toMatchObject({
      renterId: null,
      providerId: null,
      monthlyNetCents: 10730,
    });
    expect(await db.auditLog.count({ where: { action: 'contract.participants_recovered' } })).toBe(
      0
    );
  }
);

it('treats a competing participant mapping as a lost race without writing a false audit', async () => {
  const racing = db.$extends({
    query: { contract: { updateMany: async () => ({ count: 0 }) } },
  }) as unknown as PrismaClient;
  expect(await restoreParticipantsFromSigningRecords(racing)).toBe(0);
  expect(await db.auditLog.count({ where: { action: 'contract.participants_recovered' } })).toBe(0);
  expect(await restoreParticipantsFromSigningRecords(db)).toBe(1);
  expect(await restoreParticipantsFromSigningRecords(db)).toBe(0);
});

it('propagates audit failure and rolls back the participant recovery', async () => {
  const failing = db.$extends({
    query: {
      auditLog: {
        create: () => {
          throw new Error('audit unavailable');
        },
      },
    },
  }) as unknown as PrismaClient;
  await expect(restoreParticipantsFromSigningRecords(failing)).rejects.toThrow('audit unavailable');
  expect(await db.contract.findUnique({ where: { id: contractId } })).toMatchObject({
    renterId: null,
    providerId: null,
  });
});

it('does not duplicate lines added between the recovery scan and the transaction', async () => {
  const contract = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
  const racing = db.$extends({
    query: { contract: { findMany: async () => [contract] } },
  }) as unknown as PrismaClient;
  expect(await backfillLegacyLines(racing, 'operator')).toBe(0);
  expect(await db.contractLine.count({ where: { contractId } })).toBe(1);
});
