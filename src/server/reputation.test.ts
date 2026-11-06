import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets } from '@/data/load';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { seedDemoParticipants } from './demo-participants';
import type { PrismaClient } from './prisma-client';
import {
  providerBadgesForAssets,
  providerReputationForAsset,
  renterReputation,
} from './reputation';

let db: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.rating.deleteMany();
  await db.asset.deleteMany();
  await seedAssets(db, await loadAssets());
  await seedDemoParticipants(db);
});

let next = 0;
const rate = (data: {
  reviewerId: string;
  subjectId: string;
  direction: 'renter_to_provider' | 'provider_to_renter';
  stars: number;
  visibility?: 'visible' | 'hidden';
}) => {
  next += 1;
  return db.rating.create({
    data: {
      id: `rating-${next}`,
      contractId: `contract-${next}`,
      comment: `comment ${next}`,
      createdAt: new Date(Date.UTC(2026, 10, next)),
      ...data,
    },
  });
};

describe('providerReputationForAsset', () => {
  it("shows the item owner's visible ratings from renters, newest first", async () => {
    await rate({
      reviewerId: 'cust-aino',
      subjectId: 'provider-kettu',
      direction: 'renter_to_provider',
      stars: 5,
    });
    await rate({
      reviewerId: 'cust-mikko',
      subjectId: 'provider-kettu',
      direction: 'renter_to_provider',
      stars: 4,
    });
    // Not counted: hidden by a moderator, and a rating of Kettu as a renter.
    await rate({
      reviewerId: 'cust-lena',
      subjectId: 'provider-kettu',
      direction: 'renter_to_provider',
      stars: 1,
      visibility: 'hidden',
    });
    await rate({
      reviewerId: 'provider-pelto',
      subjectId: 'provider-kettu',
      direction: 'provider_to_renter',
      stars: 2,
    });

    const provider = await providerReputationForAsset(db, 'ebike-003');
    expect(provider).toMatchObject({
      providerId: 'provider-kettu',
      name: 'Kettu Mobility Oy',
      summary: { count: 2, averageTenths: 45 },
    });
    expect(provider?.reviews.map((review) => review.stars)).toEqual([4, 5]);
    expect(provider?.reviews[0]).toMatchObject({ reviewerName: 'Mikko Laine', edited: false });
  });

  it('has no average before the first rating', async () => {
    const provider = await providerReputationForAsset(db, 'ebike-003');
    expect(provider?.summary).toEqual({ count: 0, averageTenths: null });
    expect(provider?.reviews).toEqual([]);
  });

  it('is null for an unknown item', async () => {
    expect(await providerReputationForAsset(db, 'no-such-item')).toBeNull();
  });
});

describe('renterReputation', () => {
  it('shows only what providers said about you as a renter', async () => {
    await rate({
      reviewerId: 'provider-pelto',
      subjectId: 'cust-aino',
      direction: 'provider_to_renter',
      stars: 4,
    });
    await rate({
      reviewerId: 'cust-mikko',
      subjectId: 'cust-aino',
      direction: 'renter_to_provider',
      stars: 1,
    });
    const mine = await renterReputation(db, 'cust-aino');
    expect(mine.summary).toEqual({ count: 1, averageTenths: 40 });
    expect(mine.reviews).toHaveLength(1);
    expect(mine.reviews[0]).toMatchObject({ stars: 4, reviewerName: 'Pelto Agri Rental Oy' });
  });
});

describe('providerBadgesForAssets', () => {
  it("gives each item its provider's name and average, in one go", async () => {
    await rate({
      reviewerId: 'cust-aino',
      subjectId: 'provider-kettu',
      direction: 'renter_to_provider',
      stars: 4,
    });
    const badges = await providerBadgesForAssets(db, ['ebike-003', 'ebike-005', 'no-such-item']);
    expect(badges.get('ebike-003')).toEqual({
      name: 'Kettu Mobility Oy',
      count: 1,
      averageTenths: 40,
    });
    expect(badges.get('ebike-005')).toEqual({
      name: 'Aino Virtanen',
      count: 0,
      averageTenths: null,
    });
    expect(badges.has('no-such-item')).toBe(false);
  });
});
