import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets } from '@/data/load';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { dealBadgesForAssets, loadDeals, providerOffer } from './deals';
import type { PrismaClient } from './prisma-client';
import { seedDealerSide } from './providers';

const terms = [12, 24, 36, 48];
let db: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.discountRule.deleteMany();
  await db.assetOwnership.deleteMany();
  await db.provider.deleteMany();
  await db.asset.deleteMany();
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await seedDealerSide(db, assets);
});

let next = 0;
const addRule = (
  providerId: string,
  minTermMonths: number,
  maxTermMonths: number,
  discountBps: number,
  extra: { enabled?: boolean; archived?: boolean } = {}
) => {
  next += 1;
  return db.discountRule.create({
    data: {
      id: `rule-${next}`,
      providerId,
      name: `rule ${next}`,
      minTermMonths,
      maxTermMonths,
      discountBps,
      enabled: extra.enabled ?? true,
      archived: extra.archived ?? false,
    },
  });
};

describe('loadDeals', () => {
  it('lists providers with a current offer, biggest discount first', async () => {
    await addRule('provider-kettu', 24, 48, 1000);
    await addRule('provider-pelto', 36, 48, 4000);
    const deals = await loadDeals(db, terms);
    expect(deals.map((deal) => deal.providerId)).toEqual(['provider-pelto', 'provider-kettu']);
    expect(deals[0]).toMatchObject({
      name: 'Pelto Agri Rental Oy',
      tiers: [{ discountBps: 4000, fromTermMonths: 36, toTermMonths: null }],
      categories: ['farm_machine'],
    });
    expect(deals[0]?.availableCount).toBeGreaterThan(0);
  });

  it('leaves out disabled and archived rules, and unknown providers', async () => {
    await addRule('provider-kettu', 24, 48, 1000, { enabled: false });
    await addRule('provider-pelto', 24, 48, 1000, { archived: true });
    await addRule('provider-gone', 24, 48, 1000);
    expect(await loadDeals(db, terms)).toEqual([]);
  });
});

describe('dealBadgesForAssets', () => {
  it("gives each item its provider's best deal", async () => {
    await addRule('provider-kettu', 24, 48, 1000);
    await addRule('provider-kettu', 48, 48, 1500);
    const badges = await dealBadgesForAssets(db, ['ebike-003', 'farm-001'], terms);
    expect(badges.get('ebike-003')).toEqual({ discountBps: 1500, fromTermMonths: 48 });
    expect(badges.has('farm-001')).toBe(false);
  });
});

describe('providerOffer', () => {
  it("returns the provider's name and items, or null when unknown", async () => {
    const offer = await providerOffer(db, 'provider-pelto');
    expect(offer?.name).toBe('Pelto Agri Rental Oy');
    expect(offer?.assetIds.has('farm-001')).toBe(true);
    expect(offer?.assetIds.has('ebike-003')).toBe(false);
    expect(await providerOffer(db, 'provider-gone')).toBeNull();
  });
});

describe('deal edge cases', () => {
  it('leaves out a provider whose rules fit no lease term we offer', async () => {
    await addRule('provider-kettu', 60, 72, 2000);
    expect(await loadDeals(db, terms)).toEqual([]);
    expect((await dealBadgesForAssets(db, ['ebike-003'], terms)).size).toBe(0);
  });

  it('orders providers with the same top discount by name', async () => {
    await addRule('provider-pelto', 36, 48, 1000);
    await addRule('provider-kettu', 36, 48, 1000);
    const deals = await loadDeals(db, terms);
    expect(deals.map((deal) => deal.name)).toEqual(['Kettu Mobility Oy', 'Pelto Agri Rental Oy']);
  });

  it('works out a provider’s best deal once for all of its items', async () => {
    await addRule('provider-kettu', 36, 48, 1000);
    const badges = await dealBadgesForAssets(db, ['ebike-003', 'ebike-004', 'laptop-001'], terms);
    expect([...badges.keys()].sort()).toEqual(['ebike-003', 'ebike-004', 'laptop-001']);
    expect(new Set([...badges.values()].map((deal) => deal.discountBps))).toEqual(new Set([1000]));
  });
});
