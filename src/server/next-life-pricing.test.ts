import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadAssets, loadCoefficientTable, loadPriceLists, loadResidualCurves } from '@/data/load';
import { createTestDb } from '../../tests/helpers/test-db';
import { nextLifeBasis, priceNextLife } from './next-life-pricing';
import type { PrismaClient } from './prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});

it('uses the price on the model-year reference date before falling back to the earliest list', async () => {
  const asset = (await loadAssets()).find((row) => row.id === 'ebike-007')!;
  const lists = await loadPriceLists();
  const referenceAsset = { ...asset, model_year: 2026 };
  expect(await nextLifeBasis(db, referenceAsset, '2026-11-06', lists)).toMatchObject({
    ok: true,
    input: { firstLeaseListPriceCents: lists[0]!.prices[asset.id], ageMonths: 4 },
  });
  expect(await nextLifeBasis(db, asset, '2026-11-06', [...lists].reverse())).toMatchObject({
    ok: true,
    input: { firstLeaseListPriceCents: lists[0]!.prices[asset.id] },
  });
});

it('reports a missing reference price instead of valuing an imported item at zero', async () => {
  const asset = (await loadAssets())[0]!;
  const [curves, table] = await Promise.all([loadResidualCurves(), loadCoefficientTable()]);
  expect(await nextLifeBasis(db, asset, '2026-11-06', [])).toEqual({
    ok: false,
    reason: 'missing_reference_price',
  });
  expect(await priceNextLife(db, asset, '2026-11-06', { lists: [], curves, table })).toEqual({
    ok: false,
    reason: 'missing_reference_price',
  });
});
