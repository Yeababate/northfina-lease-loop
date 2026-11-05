// Runs against a real, migrated SQLite database (see tests/global-setup.ts).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/assets/[id]/co2-estimate/route';
import { loadAssets } from '@/data/load';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { estimateAssetImpact, loadImpactInputs, type ImpactInputs } from './impact';
import type { PrismaClient } from './prisma-client';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));

let db: PrismaClient;
let cleanup: () => Promise<void>;
let inputs: ImpactInputs;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  await seedAssets(db, await loadAssets());
  const loaded = await loadImpactInputs();
  if (!loaded) throw new Error('impact inputs must load');
  inputs = loaded;
});
afterAll(async () => {
  await cleanup();
});

const get = (assetId: string, query: string) =>
  GET(new Request(`http://localhost/api/assets/${assetId}/co2-estimate${query}`), {
    params: Promise.resolve({ id: assetId }),
  });

describe('loadImpactInputs', () => {
  it('wraps the data pack in the fictional factor set, proxy wear policy and default method', () => {
    expect(inputs.factors).toMatchObject({
      id: 'hackathon-fictional',
      version: 1,
      status: 'fictional_illustrative',
    });
    expect(inputs.wearPolicy).toMatchObject({ id: 'residual-proxy', basis: 'price_derived_proxy' });
    expect(inputs.method.firstUse).toEqual({ treatment: 'same_as_reuse' });
  });
});

describe('estimateAssetImpact', () => {
  it('estimates a first-use item with the same method, not zero', async () => {
    const impact = await estimateAssetImpact(db, 'ebike-003', 36, inputs);
    expect(impact).toMatchObject({
      ok: true,
      result: {
        ok: true,
        estimate: { estimatedSavingGrams: 145_200, context: 'first_use', termMonths: 36 },
      },
    });
  });

  it('gives a used item less credit from its condition and usage', async () => {
    // like_new 0.95 × (1 − 1 step × 2 %) = 0.931 → 153 615 g − 19 800 g
    const impact = await estimateAssetImpact(db, 'ebike-005', 24, inputs);
    expect(impact).toMatchObject({
      ok: true,
      result: {
        ok: true,
        estimate: { estimatedSavingGrams: 133_815, context: 'reuse', previousLives: 1 },
      },
    });
  });

  it('uses the category unit for farm machines', async () => {
    // good 0.85 × (1 − 8 steps × 3 %) = 0.646 → 11 628 000 g − 2 160 000 g
    const impact = await estimateAssetImpact(db, 'farm-005', 48, inputs);
    expect(impact.ok && impact.result.ok && impact.result.estimate.estimatedSavingGrams).toBe(
      9_468_000
    );
  });

  it('estimates every seeded asset', async () => {
    for (const asset of await loadAssets()) {
      const impact = await estimateAssetImpact(db, asset.id, 12, inputs);
      expect(impact.ok && impact.result.ok, asset.id).toBe(true);
    }
  });

  it('loads the inputs itself when none are given', async () => {
    const impact = await estimateAssetImpact(db, 'laptop-001', 12);
    expect(impact.ok && impact.result.ok).toBe(true);
  });

  it('reports a missing asset and missing inputs as values', async () => {
    expect(await estimateAssetImpact(db, 'nope', 12, inputs)).toEqual({
      ok: false,
      reason: 'asset_not_found',
    });
    expect(await estimateAssetImpact(db, 'ebike-003', 12, null)).toEqual({
      ok: false,
      reason: 'inputs_unavailable',
    });
  });

  it('writes nothing: estimating posts no audit rows', async () => {
    const before = await db.auditLog.count();
    await estimateAssetImpact(db, 'ebike-008', 36, inputs);
    expect(await db.auditLog.count()).toBe(before);
  });
});

describe('GET /api/assets/:id/co2-estimate', () => {
  it('returns the estimate in the standard envelope', async () => {
    const response = await get('ebike-003', '?term=36');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      data: {
        ok: true,
        estimate: {
          estimatedSavingGrams: 145_200,
          versions: { factorSetId: 'hackathon-fictional' },
        },
      },
    });
  });

  it('answers 404 for an unknown asset', async () => {
    const response = await get('nope', '?term=36');
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('ASSET_NOT_FOUND');
  });

  it.each(['', '?term=0', '?term=abc', '?term=1.5'])(
    'answers 400 for query "%s"',
    async (query) => {
      const response = await get('ebike-003', query);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    }
  );
});
