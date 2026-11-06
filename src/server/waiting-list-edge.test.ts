import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import * as dataLoad from '@/data/load';
import { loadAssets, loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
import { priceContract } from '@/domain/contract-pricing';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { signContract } from './contracts';
import { recordInspection, recordReceipt, recordWork } from './next-life-commands';
import type { PrismaClient } from './prisma-client';
import { seedDealerSide } from './providers';
import {
  assignWaitingListEntry,
  getWaitingListMatches,
  secondLifeNote,
  secondLifePreview,
  seedWaitingList,
} from './waiting-list';

let db: PrismaClient;
let cleanup: () => Promise<void>;
const today = '2026-11-05';
const provider = 'provider-kettu';
const intake = 'seed-ebike-007';
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  await db.waitingListEntry.deleteMany();
  await db.returnIntake.deleteMany();
  await db.contract.deleteMany();
  await db.assetOwnership.deleteMany();
  await db.asset.deleteMany();
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await seedDealerSide(db, assets);
  await seedWaitingList(db);
  await db.auditLog.deleteMany();
});
const inspect = () =>
  recordInspection(
    db,
    provider,
    intake,
    { expectedRevision: 0, condition: 'fair', usageValue: 18400, hoursSinceService: null },
    today
  );

it('shows no offer when no waiting-list entry can qualify', async () => {
  await db.waitingListEntry.deleteMany();
  expect(await secondLifeNote(db, 'ebike-007', today)).toMatchObject({
    plan: null,
    winner: null,
    others: [],
  });
});

it('does not expose a preview after the item has changed owners or been relisted', async () => {
  await db.assetOwnership.update({
    where: { assetId: 'ebike-007' },
    data: { providerId: 'provider-pelto' },
  });
  expect(await secondLifePreview(db, 'ebike-007', today)).toBeNull();
  await db.returnIntake.update({ where: { id: intake }, data: { relistedOn: today } });
  expect(await secondLifePreview(db, 'ebike-007', today)).toBeNull();
});

it('refuses a new match after relisting and reports incompatible usage data', async () => {
  await inspect();
  await db.asset.update({ where: { id: 'ebike-007' }, data: { usage_unit: 'engine_hours' } });
  await expect(getWaitingListMatches(db, provider, intake, today)).rejects.toMatchObject({
    code: 'MATCH_PRICE_UNAVAILABLE',
  });
  await db.returnIntake.update({ where: { id: intake }, data: { relistedOn: today } });
  await expect(getWaitingListMatches(db, provider, intake, today)).rejects.toMatchObject({
    code: 'MATCH_NOT_READY',
  });
});

it('treats missing price or tax data as an unavailable preview', async () => {
  const vat = await loadVatRates();
  vi.spyOn(dataLoad, 'loadVatRates').mockResolvedValue({ ...vat, rates: [] });
  expect(await secondLifePreview(db, 'ebike-007', today)).toBeNull();
  await inspect();
  await expect(getWaitingListMatches(db, provider, intake, today)).rejects.toMatchObject({
    code: 'MATCH_PRICE_UNAVAILABLE',
  });
  vi.restoreAllMocks();
  vi.spyOn(dataLoad, 'loadPriceLists').mockResolvedValue([]);
  expect(await secondLifePreview(db, 'ebike-007', today)).toBeNull();
});

it('propagates corrupt stored waiting-list statuses instead of presenting no match', async () => {
  await db.waitingListEntry.update({ where: { id: 'wait-13' }, data: { status: 'invalid' } });
  await expect(secondLifePreview(db, 'ebike-007', today)).rejects.toThrow(
    'Unknown waiting-list status'
  );
});

it('rolls back the offer and audit if another assignment wins the guarded write', async () => {
  await inspect();
  const racing = db.$extends({
    query: {
      waitingListEntry: {
        async updateMany({ args, query }) {
          return args.data.status === 'offered' ? { count: 0 } : query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
  await expect(
    assignWaitingListEntry(racing, provider, intake, 'wait-13', today)
  ).rejects.toMatchObject({ code: 'MATCH_CHANGED' });
  expect(await db.waitingListEntry.findUnique({ where: { id: 'wait-13' } })).toMatchObject({
    status: 'waiting',
    offeredAssetId: null,
  });
  expect(await db.auditLog.count({ where: { action: 'return.waiting_list_offered' } })).toBe(0);
});

it('prices recorded work without charging for it again', async () => {
  await inspect();
  await recordWork(
    db,
    provider,
    intake,
    { expectedRevision: 1, actionId: 'battery_replacement' },
    today
  );
  expect(await getWaitingListMatches(db, provider, intake, today)).toMatchObject({
    readyOn: today,
    decision: { options: expect.any(Array) },
  });
});

it('uses the lease end as its ready date for a return received early', async () => {
  const [lists, table] = await Promise.all([loadPriceLists(), loadCoefficientTable()]);
  const input = { assetId: 'ebike-003', termMonths: 12, downPaymentCents: 0 };
  const priced = priceContract(lists, table, input, today);
  if (!priced.ok) throw new Error('Expected a priceable fixture');
  const contract = await signContract(
    db,
    {
      ...input,
      actor: 'Aino',
      expectedMonthlyNetCents: priced.price.monthlyNetCents,
      expectedBuyoutNetCents: priced.price.buyoutNetCents,
      expectedPriceListVersion: 1,
    },
    today,
    lists,
    table
  );
  const receipt = await recordReceipt(db, provider, contract.id, '2026-11-06');
  await recordInspection(
    db,
    provider,
    receipt.id,
    { expectedRevision: 0, condition: 'good', usageValue: 100, hoursSinceService: null },
    '2026-11-06'
  );
  expect(await getWaitingListMatches(db, provider, receipt.id, '2026-11-06')).toMatchObject({
    readyOn: contract.endOn,
    canAssign: false,
  });
  await db.asset.update({ where: { id: contract.assetId }, data: { status: 'available' } });
  await db.returnIntake.update({
    where: { id: receipt.id },
    data: { completedOn: contract.endOn },
  });
  await expect(
    getWaitingListMatches(db, provider, receipt.id, contract.endOn)
  ).rejects.toMatchObject({ code: 'MATCH_NOT_READY' });
});
