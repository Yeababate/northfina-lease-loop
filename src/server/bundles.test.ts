// Runs against a real, migrated SQLite database (see tests/global-setup.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getOne, PUT } from '@/app/api/bundles/[id]/route';
import { GET as list, POST } from '@/app/api/bundles/route';
import { loadAssets, loadBundleOffers } from '@/data/load';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import {
  bookableBundlesWithAsset,
  createBundleOffer,
  DEMO_PROVIDER_ID,
  getBundleOffer,
  listBundleOffers,
  seedBundleOffers,
  updateBundleOffer,
} from './bundles';
import type { PrismaClient } from './prisma-client';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));

let db: PrismaClient;
let cleanup: () => Promise<void>;
const terms = [12, 24, 36, 48];
const options = { providerId: DEMO_PROVIDER_ID, supportedTerms: terms };
const input = {
  name: 'Commuter kit',
  description: 'Bike and laptop',
  assetIds: ['ebike-002', 'laptop-001'],
  terms: [36, 24],
  published: true,
};

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.bundleOffer.deleteMany();
  await db.auditLog.deleteMany();
  await db.asset.deleteMany();
  await seedAssets(db, await loadAssets());
});

const json = (body: unknown, method = 'POST') =>
  new Request('http://test/api/bundles', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('bundle groupings', () => {
  it('creates a bundle with its items and an audit row in one transaction', async () => {
    const offer = await createBundleOffer(db, input, { ...options, id: 'kit' });
    expect(offer).toMatchObject({
      id: 'kit',
      providerId: DEMO_PROVIDER_ID,
      assetIds: ['ebike-002', 'laptop-001'],
      terms: [24, 36],
      revision: 1,
      availability: { bookable: true, reasons: [] },
    });
    const audit = await db.auditLog.findMany();
    expect(audit.map((row) => [row.action, row.entity_id])).toEqual([
      ['bundle_offer.created', 'kit'],
    ]);
  });

  it('rejects an invalid bundle and writes nothing, not even the audit row', async () => {
    await expect(
      createBundleOffer(db, { ...input, assetIds: ['ebike-002', 'ebike-002', 'ghost'] }, options)
    ).rejects.toMatchObject({ status: 422, code: 'INVALID_BUNDLE' });
    expect(await db.bundleOffer.count()).toBe(0);
    expect(await db.bundleOfferItem.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it('rejects a bundle for a provider that does not own the assets', async () => {
    await expect(
      createBundleOffer(db, input, { ...options, providerId: 'someone-else' })
    ).rejects.toMatchObject({ status: 422, code: 'INVALID_BUNDLE' });
    expect(await db.auditLog.count()).toBe(0);
  });

  it('hides a bundle from renters as soon as one component is reserved', async () => {
    await createBundleOffer(db, input, { ...options, id: 'kit' });
    expect((await listBundleOffers(db, { kind: 'public' })).map((o) => o.id)).toEqual(['kit']);
    expect((await bookableBundlesWithAsset(db, 'laptop-001')).map((o) => o.id)).toEqual(['kit']);

    await db.asset.update({ where: { id: 'laptop-001' }, data: { status: 'reserved' } });
    expect(await listBundleOffers(db, { kind: 'public' })).toEqual([]);
    expect(await bookableBundlesWithAsset(db, 'ebike-002')).toEqual([]);
    expect(await getBundleOffer(db, 'kit', { providerId: null })).toBeNull();

    const [mine] = await listBundleOffers(db, { kind: 'provider', providerId: DEMO_PROVIDER_ID });
    expect(mine?.availability).toEqual({
      bookable: false,
      reasons: [{ code: 'component_not_available', assetId: 'laptop-001', status: 'reserved' }],
    });
    expect(await getBundleOffer(db, 'kit', { providerId: DEMO_PROVIDER_ID })).not.toBeNull();
    // Editing or blocking a bundle never reserves or changes inventory.
    expect((await db.asset.findUnique({ where: { id: 'ebike-002' } }))?.status).toBe('available');
  });

  it('keeps unpublished bundles to the provider', async () => {
    await createBundleOffer(db, { ...input, published: false }, { ...options, id: 'draft' });
    expect(await listBundleOffers(db, { kind: 'public' })).toEqual([]);
    const [draft] = await listBundleOffers(db, { kind: 'provider', providerId: DEMO_PROVIDER_ID });
    expect(draft?.availability.reasons).toEqual([{ code: 'not_published' }]);
    expect(await listBundleOffers(db, { kind: 'provider', providerId: 'other' })).toEqual([]);
  });

  it('updates with a new revision and rejects stale or foreign edits', async () => {
    await createBundleOffer(db, input, { ...options, id: 'kit' });
    const updated = await updateBundleOffer(
      db,
      'kit',
      { ...input, assetIds: ['laptop-001', 'ebike-003', 'ebike-002'], expectedRevision: 1 },
      options
    );
    expect(updated.revision).toBe(2);
    expect(updated.assetIds).toEqual(['laptop-001', 'ebike-003', 'ebike-002']);

    await expect(
      updateBundleOffer(db, 'kit', { ...input, expectedRevision: 1 }, options)
    ).rejects.toMatchObject({ status: 409, code: 'BUNDLE_CHANGED' });
    await expect(
      updateBundleOffer(
        db,
        'kit',
        { ...input, expectedRevision: 2 },
        { ...options, providerId: 'other' }
      )
    ).rejects.toMatchObject({ status: 404, code: 'BUNDLE_NOT_FOUND' });
    // A failed edit leaves the saved items alone.
    await expect(
      updateBundleOffer(
        db,
        'kit',
        { ...input, assetIds: ['ebike-002'], expectedRevision: 2 },
        options
      )
    ).rejects.toMatchObject({ status: 422 });
    const kept = await getBundleOffer(db, 'kit', { providerId: DEMO_PROVIDER_ID });
    expect(kept?.assetIds).toEqual(['laptop-001', 'ebike-003', 'ebike-002']);
    expect((await db.auditLog.findMany()).map((row) => row.action)).toEqual([
      'bundle_offer.created',
      'bundle_offer.updated',
    ]);
  });

  it('seeds the example bundles once', async () => {
    const seeds = await loadBundleOffers();
    expect(await seedBundleOffers(db, seeds, terms)).toEqual({
      created: seeds.length,
      skipped: 0,
    });
    expect(await seedBundleOffers(db, seeds, terms)).toEqual({
      created: 0,
      skipped: seeds.length,
    });
    expect((await listBundleOffers(db, { kind: 'public' })).length).toBe(seeds.length);
  });
});

describe('bundle API routes', () => {
  it('creates, lists, reads and updates through the envelope', async () => {
    const created = await POST(json(input), undefined);
    expect(created.status).toBe(201);
    const { data } = await created.json();
    expect(data.assetIds).toEqual(input.assetIds);

    const listed = await (await list(new Request('http://test/api/bundles'), undefined)).json();
    expect(listed.data.map((o: { id: string }) => o.id)).toEqual([data.id]);

    const one = await getOne(new Request(`http://test/api/bundles/${data.id}`), params(data.id));
    expect(one.status).toBe(200);

    const put = await PUT(
      json({ ...input, published: false, expectedRevision: 1 }, 'PUT'),
      params(data.id)
    );
    expect((await put.json()).data).toMatchObject({ revision: 2, published: false });

    const hidden = await getOne(new Request(`http://test/api/bundles/${data.id}`), params(data.id));
    expect(hidden.status).toBe(404);
    const provider = await getOne(
      new Request(`http://test/api/bundles/${data.id}?scope=provider`),
      params(data.id)
    );
    expect(provider.status).toBe(200);
    const providerList = await list(
      new Request('http://test/api/bundles?scope=provider'),
      undefined
    );
    expect((await providerList.json()).data).toHaveLength(1);
  });

  it('answers invalid bundles with codes, never raw errors', async () => {
    const response = await POST(json({ ...input, assetIds: ['ebike-002'] }), undefined);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe('INVALID_BUNDLE');
    expect(body.error.details).toEqual([{ code: 'too_few_items' }]);
    const bad = await POST(json({ ...input, price: 1 }), undefined);
    expect(bad.status).toBe(400);
  });
});
