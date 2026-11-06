// Runs against a real, migrated SQLite database (see tests/global-setup.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/assets/[id]/related/route';
import {
  loadAssets,
  loadCoefficientTable,
  loadPriceLists,
  loadRelatedItemRules,
} from '@/data/load';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { createBundleOffer } from './bundles';
import { seedDealerSide } from './providers';
import type { PrismaClient } from './prisma-client';
import { relatedItemsFor, type RelatedItemsData } from './related-items';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
vi.mock('@/server/today', () => ({ todayIso: () => '2026-11-05' }));

let db: PrismaClient;
let cleanup: () => Promise<void>;
let data: RelatedItemsData;

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const [lists, table, rules] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadRelatedItemRules(),
  ]);
  data = { lists, table, rules };
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.bundleOffer.deleteMany();
  await db.auditLog.deleteMany();
  await db.asset.deleteMany();
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await seedDealerSide(db, assets); // bundles check each item's stored owner
});

const query = { assetId: 'ebike-003', termMonths: 36, onDate: '2026-11-05' };
const get = (path: string, id: string) =>
  GET(new Request(`http://test${path}`), { params: Promise.resolve({ id }) });

describe('relatedItemsFor', () => {
  it('ranks the data pack deterministically within the configured limit', async () => {
    const first = await relatedItemsFor(db, query, data);
    const second = await relatedItemsFor(db, query, data);
    expect(first).toEqual(second);
    if (first.status !== 'ok') throw new Error('expected a ranking');
    expect(first.monthlyNetCents).toBe(10730);
    const ids = first.items.map((item) => item.asset.id);
    expect(ids).toHaveLength(data.rules.limit);
    // ebike-012 is the same model at the same price: the best possible match.
    expect(ids[0]).toBe('ebike-012');
    expect(ids).not.toContain('ebike-003');
    // Reserved (ebike-009) and returned, not yet relisted (ebike-007) items never appear.
    expect(ids).not.toContain('ebike-009');
    expect(ids).not.toContain('ebike-007');
    expect(first.items.every((item) => item.asset.category === 'e_bike')).toBe(true);
  });

  it('reacts to a stock change on the next request', async () => {
    await db.asset.update({ where: { id: 'ebike-012' }, data: { status: 'reserved' } });
    const result = await relatedItemsFor(db, query, data);
    if (result.status !== 'ok') throw new Error('expected a ranking');
    expect(result.items.map((item) => item.asset.id)).not.toContain('ebike-012');
  });

  it('reports a missing item and an item without a price basis', async () => {
    expect(await relatedItemsFor(db, { ...query, assetId: 'nope' }, data)).toEqual({
      status: 'not_found',
    });
    expect(await relatedItemsFor(db, { ...query, assetId: 'ebike-010' }, data)).toEqual({
      status: 'cannot_be_priced',
      items: [],
    });
  });
});

describe('GET /api/assets/:id/related', () => {
  it('returns ranked items with reasons and bookable bundles that include the item', async () => {
    await createBundleOffer(
      db,
      {
        name: 'Kit',
        description: '',
        assetIds: ['ebike-003', 'laptop-001'],
        terms: [36],
        published: true,
      },
      { providerId: 'provider-kettu', supportedTerms: [12, 24, 36, 48], id: 'kit' }
    );
    const response = await get('/api/assets/ebike-003/related?term=36', 'ebike-003');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      assetId: 'ebike-003',
      termMonths: 36,
      priceBasis: 'monthly_net_rent_same_term_no_down_payment',
      rulesVersion: 1,
      monthlyNetCents: 10730,
    });
    expect(body.data.items[0]).toMatchObject({
      assetId: 'ebike-012',
      reasons: ['same_category', 'similar_monthly_price', 'same_or_better_condition'],
    });
    expect(body.data.bundles.map((b: { id: string }) => b.id)).toEqual(['kit']);
  });

  it('applies a budget and validates the query', async () => {
    const budgeted = await (
      await get('/api/assets/ebike-003/related?term=36&budget=9000', 'ebike-003')
    ).json();
    for (const item of budgeted.data.items) {
      expect(item.monthlyNetCents).toBeLessThanOrEqual(9000);
      expect(item.reasons).toContain('within_budget');
    }
    expect((await get('/api/assets/ebike-003/related?term=18', 'ebike-003')).status).toBe(400);
    expect((await get('/api/assets/ebike-003/related?budget=-1', 'ebike-003')).status).toBe(400);
    expect((await get('/api/assets/ebike-003/related?x=1', 'ebike-003')).status).toBe(400);
    expect((await get('/api/assets/nope/related', 'nope')).status).toBe(404);
  });

  it('returns an empty list, not an error, when the item cannot be priced', async () => {
    const body = await (await get('/api/assets/ebike-010/related', 'ebike-010')).json();
    expect(body.data).toMatchObject({ monthlyNetCents: null, items: [], bundles: [] });
  });
});
