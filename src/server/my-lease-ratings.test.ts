import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../tests/helpers/test-db';
import { myLeaseRatingPrompts } from './my-lease-ratings';
import type { PrismaClient } from './prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});

async function contract(id: string, status: string | null, renterId = 'renter') {
  await db.contract.create({
    data: {
      id,
      actor: 'Applicant',
      assetId: 'asset',
      startOn: '2026-01-01',
      endOn: '2026-02-01',
      signedOn: '2026-01-01',
      termMonths: 12,
      downPaymentCents: 0,
      listPriceCents: 100000,
      priceListVersion: 1,
      coefficientVersion: 1,
      coefficientId: 'table',
      band: 'A',
      factor: 0.01,
      financedCents: 100000,
      monthlyNetCents: 1000,
      buyoutNetCents: 20000,
      renterId,
      providerId: 'provider',
      ...(status ? { lifecycle: { create: { status } } } : {}),
    },
  });
}

beforeEach(async () => {
  await db.ratingRevision.deleteMany();
  await db.rating.deleteMany();
  await db.contractLifecycle.deleteMany();
  await db.contractLine.deleteMany();
  await db.contract.deleteMany();
  await contract('rated', 'completed_return');
  await contract('unrated', 'completed_buyout');
  await contract('running', null);
  await contract('someone-else', 'completed_return', 'other');
  await db.rating.createMany({
    data: [
      {
        id: 'r1',
        contractId: 'rated',
        reviewerId: 'renter',
        subjectId: 'provider',
        direction: 'renter_to_provider',
        stars: 4,
      },
      // The provider's rating of the renter is not the renter's own rating.
      {
        id: 'r2',
        contractId: 'unrated',
        reviewerId: 'provider',
        subjectId: 'renter',
        direction: 'provider_to_renter',
        stars: 2,
      },
    ],
  });
});

describe('myLeaseRatingPrompts', () => {
  it('gives each rented lease its own rating, an invitation or nothing', async () => {
    const prompts = await myLeaseRatingPrompts(db, 'renter');
    expect(Object.fromEntries(prompts)).toEqual({
      rated: { kind: 'rated', stars: 4 },
      unrated: { kind: 'rate' },
      running: { kind: 'none' },
    });
  });

  it('is empty for someone who rents nothing', async () => {
    expect((await myLeaseRatingPrompts(db, 'provider')).size).toBe(0);
  });
});
