import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets } from '@/data/load';
import { listPriceOn } from '@/domain/price-list';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { seedDemoParticipants } from './demo-participants';
import { loadPricingLists } from './price-lists';
import type { PrismaClient } from './prisma-client';
import { seedDealerSide } from './providers';
import { nextLifePlanFor, prepareReturnedItems } from './second-life';

const today = '2026-11-06';
let db: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  for (const table of [
    'refurbishmentWork',
    'returnInspection',
    'assetLifecycleEvent',
    'returnIntake',
    'assetOwnership',
    'provider',
    'asset',
  ] as const) {
    await (db[table] as { deleteMany: () => Promise<unknown> }).deleteMany();
  }
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await seedDealerSide(db, assets); // imports the data pack's returned items
  await seedDemoParticipants(db);
});

describe('prepareReturnedItems', () => {
  it('refurbishes and relists ebike-007 at its next-life price, audited', async () => {
    const result = await prepareReturnedItems(db, today);
    expect(result.relisted).toBeGreaterThan(0);

    const asset = await db.asset.findUniqueOrThrow({ where: { id: 'ebike-007' } });
    expect(asset).toMatchObject({ status: 'available', condition: 'good', usage_value: 0 });
    const intake = await db.returnIntake.findFirstOrThrow({ where: { assetId: 'ebike-007' } });
    expect(intake).toMatchObject({ relistedOn: today, nextLifePriceCents: 151_661 });
    expect(
      (await db.refurbishmentWork.findMany({ where: { intakeId: intake.id } }))
        .map((work) => work.actionId)
        .sort()
    ).toEqual(['battery_replacement', 'safety_inspection', 'upgrade:fair->good']);
    expect(await db.auditLog.count({ where: { action: 'return.relisted' } })).toBe(result.relisted);
  });

  it('prices the relisted item at its next-life price for customers', async () => {
    await prepareReturnedItems(db, today);
    expect(listPriceOn(await loadPricingLists(db), 'ebike-007', today)).toMatchObject({
      ok: true,
      priceCents: 151_661,
    });
  });

  it('leaves items the rules cannot decide as returned, and is safe to run again', async () => {
    await prepareReturnedItems(db, today);
    expect((await db.asset.findUniqueOrThrow({ where: { id: 'farm-005' } })).status).toBe(
      'returned'
    );
    expect((await db.asset.findUniqueOrThrow({ where: { id: 'laptop-006' } })).status).toBe(
      'returned'
    );
    const again = await prepareReturnedItems(db, today);
    expect(again.relisted).toBe(0);
  });
});

describe('nextLifePlanFor', () => {
  it('shows the stored decision after relisting and a fresh one while waiting', async () => {
    const waiting = await nextLifePlanFor(db, 'ebike-007', today);
    expect(waiting).toMatchObject({ relistedOn: null, plan: { ok: true } });
    await prepareReturnedItems(db, today);
    const stored = await nextLifePlanFor(db, 'ebike-007', today);
    expect(stored).toMatchObject({
      relistedOn: today,
      plan: { ok: true, chosen: { kind: 'refurbished', match: { requestId: 'wait-13' } } },
    });
    expect(await nextLifePlanFor(db, 'ebike-003', today)).toBeNull();
  });

  it('explains an item that cannot be leased on its own', async () => {
    await prepareReturnedItems(db, today);
    expect(await nextLifePlanFor(db, 'laptop-006', today)).toMatchObject({
      plan: { ok: false, reason: 'too_cheap_to_lease' },
    });
  });
});
