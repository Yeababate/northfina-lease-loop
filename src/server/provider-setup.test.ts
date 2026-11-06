import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadAssets, loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
import { priceContract } from '@/domain/contract-pricing';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { generateInvoices } from './invoices';
import { seedDealerSide } from './providers';
import type { PrismaClient } from './prisma-client';

let db: PrismaClient, cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});

it('adds missing providers and inventory links repeatably without overwriting existing money or dealer records', async () => {
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await db.provider.create({
    data: { id: 'provider-kettu', displayName: 'Existing customised dealer' },
  });
  await db.assetOwnership.create({
    data: { assetId: 'laptop-001', providerId: 'provider-kettu', source: 'transfer' },
  });
  // The data pack still says returned: reseeding must respect the user's current status.
  await db.asset.update({
    where: { id: 'ebike-007' },
    data: { status: 'reserved', model: 'Preserved custom model' },
  });
  await db.provider.create({
    data: { id: 'provider-custom', displayName: 'Existing transferred stock owner' },
  });
  await db.assetOwnership.create({
    data: { assetId: 'ebike-008', providerId: 'provider-custom', source: 'transfer' },
  });
  const [lists, table, vat] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
  ]);
  const price = priceContract(
    lists,
    table,
    { assetId: 'ebike-003', termMonths: 36, downPaymentCents: 0 },
    '2026-11-05'
  );
  if (!price.ok) throw new Error('Fixture pricing failed');
  await db.contract.create({
    data: { id: 'existing-contract', actor: 'Existing renter', ...price.price },
  });
  await generateInvoices(db, 'existing-contract', 'Existing renter', vat);
  const before = {
    assets: await db.asset.findMany({ orderBy: { id: 'asc' } }),
    providers: await db.provider.findMany(),
    ownership: await db.assetOwnership.findMany({ orderBy: { assetId: 'asc' } }),
    contracts: await db.contract.findMany(),
    invoices: await db.invoice.findMany(),
  };
  const created = await seedDealerSide(db, assets);
  expect(created.providers).toBe(2);
  for (const provider of before.providers)
    expect(await db.provider.findUnique({ where: { id: provider.id } })).toEqual(provider);
  expect(await db.asset.findMany({ orderBy: { id: 'asc' } })).toEqual(before.assets);
  expect(await db.contract.findMany()).toEqual(before.contracts);
  expect(await db.invoice.findMany()).toEqual(before.invoices);
  for (const owner of before.ownership)
    expect(await db.assetOwnership.findUnique({ where: { assetId: owner.assetId } })).toEqual(
      owner
    );
  expect(await db.assetOwnership.findUnique({ where: { assetId: 'laptop-002' } })).toMatchObject({
    providerId: 'provider-kettu',
  });
  expect(await db.assetOwnership.findUnique({ where: { assetId: 'farm-002' } })).toMatchObject({
    providerId: 'provider-pelto',
  });
  expect(await db.returnIntake.findUnique({ where: { id: 'seed-ebike-007' } })).toBeNull();
  expect(await db.returnIntake.findUnique({ where: { id: 'seed-ebike-008' } })).toMatchObject({
    providerId: 'provider-custom',
  });
  const counts = [
    await db.provider.count(),
    await db.assetOwnership.count(),
    await db.returnIntake.count(),
    await db.auditLog.count(),
  ];
  expect(await seedAssets(db, assets)).toEqual({ created: 0, skipped: assets.length });
  expect(await seedDealerSide(db, assets)).toEqual({ providers: 0, ownership: 0, intakes: 0 });
  expect([
    await db.provider.count(),
    await db.assetOwnership.count(),
    await db.returnIntake.count(),
    await db.auditLog.count(),
  ]).toEqual(counts);
  expect(await db.asset.findMany({ orderBy: { id: 'asc' } })).toEqual(before.assets);
  expect(await db.contract.findMany()).toEqual(before.contracts);
  expect(await db.invoice.findMany()).toEqual(before.invoices);
});
