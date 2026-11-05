import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadAssets, loadCoefficientTable, loadPriceLists } from '@/data/load';
import { createTestDb } from '../../tests/helpers/test-db';
import type { PrismaClient } from './prisma-client';
import { seedAssets } from './assets';
import { seedDemoParticipants } from './demo-participants';
import { signContract } from './contracts';
import { backfillLegacyLines, mapLegacyParticipants } from './legacy-contracts';
import { getParticipantDocument, listParticipantContracts } from './profile';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});

it('reconciles legacy identities and lines explicitly without re-pricing or inventing an original', async () => {
  await seedAssets(db, await loadAssets());
  await seedDemoParticipants(db);
  const [lists, table] = await Promise.all([loadPriceLists(), loadCoefficientTable()]);
  const contract = await signContract(
    db,
    {
      assetId: 'ebike-003',
      actor: 'Aino Virtanen',
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
  // Represent the exact state of a row created before the new tables existed.
  await db.contractLine.deleteMany();
  await db.contractDocument.deleteMany();
  expect(await listParticipantContracts(db, 'cust-aino')).toEqual([]);
  const input = {
    contractId: contract.id,
    renterId: 'cust-aino',
    providerId: 'provider-north',
    actor: 'operator',
  };
  await expect(
    mapLegacyParticipants(db, { ...input, providerId: input.renterId })
  ).rejects.toMatchObject({ code: 'INVALID_PARTICIPANTS' });
  await expect(
    mapLegacyParticipants(db, { ...input, providerId: 'unknown' })
  ).rejects.toMatchObject({ code: 'INVALID_PARTICIPANTS' });
  expect(await mapLegacyParticipants(db, input)).toMatchObject({
    renterId: 'cust-aino',
    monthlyNetCents: 10730,
    priceListVersion: 1,
  });
  await expect(mapLegacyParticipants(db, input)).rejects.toMatchObject({
    code: 'CONTRACT_ALREADY_MAPPED',
  });
  expect(await backfillLegacyLines(db, 'operator')).toBe(1);
  expect(await backfillLegacyLines(db, 'operator')).toBe(0);
  const line = await db.contractLine.findFirstOrThrow();
  expect(line).toMatchObject({
    monthlyNetCents: contract.monthlyNetCents,
    factor: contract.factor,
    buyoutNetCents: contract.buyoutNetCents,
  });
  await expect(getParticipantDocument(db, 'cust-aino', contract.id)).rejects.toMatchObject({
    code: 'DOCUMENT_UNAVAILABLE',
  });
  expect(await db.contractDocument.count()).toBe(0);
  expect(await db.auditLog.count({ where: { action: 'contract.participants_mapped' } })).toBe(1);
  expect(await db.auditLog.count({ where: { action: 'contract.legacy_line_imported' } })).toBe(1);
});
