import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../tests/helpers/test-db';
import { availabilityForAssets } from './catalogue-availability';
import type { PrismaClient } from './prisma-client';

const TODAY = '2026-11-06';

let db: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.contractLifecycle.deleteMany();
  await db.contract.deleteMany();
});

/** A signed lease of `assetId` with only the fields this feature reads being meaningful. */
async function lease(id: string, assetId: string, endOn: string, actualEndOn?: string) {
  await db.contract.create({
    data: {
      id,
      actor: 'test',
      assetId,
      startOn: '2025-01-01',
      endOn,
      signedOn: '2025-01-01',
      termMonths: 12,
      downPaymentCents: 0,
      listPriceCents: 100_000,
      priceListVersion: 1,
      coefficientVersion: 1,
      coefficientId: 'test',
      band: 'A',
      factor: 0.09,
      financedCents: 100_000,
      monthlyNetCents: 9_000,
      buyoutNetCents: 0,
      ...(actualEndOn ? { lifecycle: { create: { actualEndOn, status: 'returned' } } } : {}),
    },
  });
}

describe('availabilityForAssets', () => {
  it('returns nothing and asks nothing for no assets', async () => {
    expect((await availabilityForAssets(db, [], TODAY)).size).toBe(0);
  });

  it('uses the latest lease end, with an actual end replacing the planned one', async () => {
    await lease('c-1', 'ebike-009', '2026-11-20');
    await lease('c-2', 'ebike-009', '2027-05-01', '2026-11-16');
    await lease('c-3', 'laptop-006', '2027-02-01');
    const result = await availabilityForAssets(
      db,
      [
        { id: 'ebike-001', status: 'available' },
        { id: 'ebike-009', status: 'reserved' },
        { id: 'laptop-006', status: 'returned' },
        { id: 'farm-005', status: 'returned' },
        { id: 'ebike-008', status: 'reserved' },
      ],
      TODAY
    );
    expect(Object.fromEntries(result)).toEqual({
      'ebike-001': { kind: 'now' },
      'ebike-009': { kind: 'soon', readyOn: '2026-11-20', days: 14 },
      'laptop-006': { kind: 'later', readyOn: '2027-02-01', days: 87 },
      'farm-005': { kind: 'soon', readyOn: TODAY, days: 0 },
      'ebike-008': { kind: 'unknown' },
    });
  });
});
