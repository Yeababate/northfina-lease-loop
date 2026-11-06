import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  loadAssets,
  loadCoefficientTable,
  loadPriceLists,
  loadQuestions,
  loadVatRates,
} from '@/data/load';
import { priceContract } from '@/domain/contract-pricing';
import { createTestDb } from '../../tests/helpers/test-db';
import { assetPriceOverride, seedAssets } from './assets';
import { signApplication, type SigningData } from './contracts';
import { seedDemoParticipants } from './demo-participants';
import { ensureDemoUser } from './mock-users';
import { recordInspection, recordReceipt, recordWork, relist } from './next-life-commands';
import { getReturn } from './next-life-reads';
import type { PrismaClient } from './prisma-client';
import { seedDealerSide } from './providers';
import { assignWaitingListEntry, seedWaitingList } from './waiting-list';
import { placementBlocksViewer } from './waiting-list-placement';
import { expireWaitingPlacements } from './waiting-list-expiry';
import { readinessForAssets } from './lease-readiness';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let data: SigningData;
const today = '2026-11-05';
const provider = 'provider-kettu';
const intakeId = 'seed-ebike-007';
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const [lists, table, vatRates, { questions }] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
    loadQuestions(),
  ]);
  data = { lists, table, vatRates, questions };
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.contract.deleteMany();
  await db.waitingListEntry.deleteMany();
  await db.returnIntake.deleteMany();
  await db.asset.deleteMany();
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await seedDealerSide(db, assets);
  await seedDemoParticipants(db);
  await seedWaitingList(db);
});

async function apply(userId: string, assetId = 'ebike-007', termMonths = 12, on = today) {
  const row = await db.asset.findUniqueOrThrow({ where: { id: assetId } });
  const choice = { assetId, termMonths, downPaymentCents: 0, startOn: on };
  const price = priceContract(data.lists, data.table, choice, on, [], assetPriceOverride(row));
  if (!price.ok) throw new Error(price.reason);
  return signApplication(
    db,
    {
      ...choice,
      answers: {
        q_customer_type: 'consumer',
        q_full_name: 'Aino Virtanen',
        q_birth_date: '1997-04-12',
        q_email: 'aino@example.com',
        q_country: 'FI',
        q_employment: 'employed',
        q_monthly_income: 320000,
        q_usage_purpose: 'delivery',
      },
      expectedMonthlyNetCents: price.price.monthlyNetCents,
      expectedBuyoutNetCents: price.price.buyoutNetCents,
      expectedPriceListVersion: price.price.priceListVersion,
      expectedPriceSource: price.price.priceSource,
    },
    on,
    data,
    userId
  );
}

async function prepare() {
  await recordInspection(
    db,
    provider,
    intakeId,
    { expectedRevision: 0, condition: 'fair', usageValue: 18400, hoursSinceService: null },
    today
  );
  await assignWaitingListEntry(db, provider, intakeId, 'wait-02', today);
  await recordWork(
    db,
    provider,
    intakeId,
    { expectedRevision: 1, actionId: 'battery_replacement' },
    today
  );
  await recordWork(
    db,
    provider,
    intakeId,
    { expectedRevision: 2, actionId: 'safety_inspection' },
    today
  );
}

it('places the original fair bike with its named recipient without allowing public leasing', async () => {
  const renter = await ensureDemoUser(db, 'Aino');
  const other = await ensureDemoUser(db, 'Other renter');
  await prepare();
  await expect(
    relist(db, provider, intakeId, { expectedRevision: 3 }, today)
  ).rejects.toMatchObject({ code: 'NOT_READY' });
  await expect(
    relist(
      db,
      provider,
      intakeId,
      {
        expectedRevision: 3,
        waitingListEntryId: 'wait-02',
      },
      today
    )
  ).rejects.toMatchObject({ code: 'OFFER_RECIPIENT_REQUIRED' });
  await relist(
    db,
    provider,
    intakeId,
    {
      expectedRevision: 3,
      waitingListEntryId: 'wait-02',
      renterId: renter.id,
    },
    today
  );
  expect(await db.asset.findUniqueOrThrow({ where: { id: 'ebike-007' } })).toMatchObject({
    condition: 'fair',
    status: 'available',
    usage_value: 0,
  });
  expect(await placementBlocksViewer(db, 'ebike-007', other.id, today)).toBe(true);
  expect(await placementBlocksViewer(db, 'ebike-007', renter.id, today)).toBe(false);
  const query = { assetIds: ['ebike-007'], termMonths: 12, downPaymentCents: 0, profileKey: null };
  expect((await readinessForAssets(db, other.id, query, today, data)).items[0]?.status).toBe(
    'not_leasable'
  );
  expect((await readinessForAssets(db, renter.id, query, today, data)).items[0]?.status).not.toBe(
    'not_leasable'
  );
  await expect(apply(other.id)).rejects.toMatchObject({ code: 'ASSET_ALREADY_OFFERED' });
  await expect(apply(renter.id, 'ebike-007', 24)).rejects.toMatchObject({ code: 'OFFER_CHANGED' });
  const contract = await apply(renter.id);
  expect(contract).toMatchObject({
    renterId: renter.id,
    priceSource: 'next_life',
    usagePurpose: 'delivery',
    vatRegistered: null,
  });
  expect(await db.waitingListEntry.findUniqueOrThrow({ where: { id: 'wait-02' } })).toMatchObject({
    status: 'matched',
    offeredAssetId: null,
  });
  await expect(apply(renter.id)).rejects.toMatchObject({ code: 'ASSET_UNAVAILABLE' });
});

it('retains declared delivery use for the provider inspection and signing audit', async () => {
  const renter = await ensureDemoUser(db, 'Aino');
  const contract = await apply(renter.id, 'ebike-003', 36);
  const receipt = await recordReceipt(db, provider, contract.id, contract.endOn);
  expect((await getReturn(db, provider, receipt.id)).lease).toMatchObject({
    usagePurpose: 'delivery',
    inspectionFocus: 'delivery_wear',
  });
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: 'contract.signed', entity_id: contract.id },
  });
  expect(JSON.parse(audit.details_json!).usagePurpose).toBe('delivery');
});

it('rejects expired fair placements and preserves the stock and offer on failure', async () => {
  const renter = await ensureDemoUser(db, 'Aino');
  await prepare();
  await relist(
    db,
    provider,
    intakeId,
    {
      expectedRevision: 3,
      waitingListEntryId: 'wait-02',
      renterId: renter.id,
    },
    today
  );
  await expect(apply(renter.id, 'ebike-007', 12, '2026-11-11')).rejects.toMatchObject({
    code: 'PLACEMENT_REQUIRED',
  });
  expect(await db.contract.count()).toBe(0);
  expect(await expireWaitingPlacements(db, '2026-11-11')).toBe(1);
  expect(await expireWaitingPlacements(db, '2026-11-11')).toBe(0);
  const reopened = await getReturn(db, provider, intakeId);
  expect(reopened).toMatchObject({ relistedOn: null, stage: 'needs_work' });
  expect(reopened.asset.status).toBe('returned');
  expect(reopened.outstanding).toEqual(['upgrade:fair->good']);
  const upgraded = await recordWork(
    db,
    provider,
    intakeId,
    { expectedRevision: reopened.revision, actionId: 'upgrade:fair->good' },
    '2026-11-11'
  );
  await relist(db, provider, intakeId, { expectedRevision: upgraded.revision }, '2026-11-11');
  expect(await db.asset.findUniqueOrThrow({ where: { id: 'ebike-007' } })).toMatchObject({
    condition: 'good',
    status: 'available',
  });
});

it('never lets a provider replace the owner of a customer-created waiting entry', async () => {
  const renter = await ensureDemoUser(db, 'Aino');
  const other = await ensureDemoUser(db, 'Other renter');
  await prepare();
  await db.waitingListEntry.update({
    where: { id: 'wait-02' },
    data: { participantId: renter.id },
  });
  await expect(
    relist(
      db,
      provider,
      intakeId,
      {
        expectedRevision: 3,
        waitingListEntryId: 'wait-02',
        renterId: other.id,
      },
      today
    )
  ).rejects.toMatchObject({ code: 'OFFER_RECIPIENT_REQUIRED' });
});

it('requires mandatory work even when the recipient accepts fair condition', async () => {
  const renter = await ensureDemoUser(db, 'Aino');
  await recordInspection(
    db,
    provider,
    intakeId,
    { expectedRevision: 0, condition: 'fair', usageValue: 18400, hoursSinceService: null },
    today
  );
  await assignWaitingListEntry(db, provider, intakeId, 'wait-02', today);
  await expect(
    relist(
      db,
      provider,
      intakeId,
      { expectedRevision: 1, waitingListEntryId: 'wait-02', renterId: renter.id },
      today
    )
  ).rejects.toMatchObject({ code: 'NOT_READY' });
  expect((await getReturn(db, provider, intakeId)).revision).toBe(1);
});

it('rechecks the offer budget before exposing prepared stock', async () => {
  const renter = await ensureDemoUser(db, 'Aino');
  await prepare();
  await db.waitingListEntry.update({
    where: { id: 'wait-02' },
    data: { maxMonthlyNetRentCents: 1 },
  });
  await expect(
    relist(
      db,
      provider,
      intakeId,
      { expectedRevision: 3, waitingListEntryId: 'wait-02', renterId: renter.id },
      today
    )
  ).rejects.toMatchObject({ code: 'OFFER_CHANGED' });
  expect((await getReturn(db, provider, intakeId)).revision).toBe(3);
  expect((await db.asset.findUniqueOrThrow({ where: { id: 'ebike-007' } })).status).toBe(
    'returned'
  );
});
