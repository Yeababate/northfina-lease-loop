import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { GET, PUT } from '@/app/api/dealer-discount/route';
import { loadAssets, loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
import { priceContract } from '@/domain/contract-pricing';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { seedDealerSide } from './providers';
import { dealerDiscountView, saveDealerDiscount } from './dealer-discount';
import { rulesForAsset, saveDiscountRule } from './discount-rules';
import { generateInvoices } from './invoices';
import type { PrismaClient } from './prisma-client';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
vi.mock('@/server/today', () => ({ todayIso: () => '2026-11-06' }));
let db: PrismaClient, cleanup: () => Promise<void>;
let table: Awaited<ReturnType<typeof loadCoefficientTable>>,
  lists: Awaited<ReturnType<typeof loadPriceLists>>;
const OWNER = 'cust-aino';
const input = {
  minTermMonths: 36,
  discountBps: 1000,
  enabled: true,
  expectedRules: [] as { id: string; revision: number }[],
  confirmReplacement: false,
};
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await seedDealerSide(db, assets);
  [table, lists] = await Promise.all([loadCoefficientTable(), loadPriceLists()]);
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.invoice.deleteMany();
  await db.contract.deleteMany();
  await db.discountRule.deleteMany();
  await db.auditLog.deleteMany();
});
const request = (body?: unknown, owner: string | null = OWNER) =>
  new Request('http://localhost/api/dealer-discount', {
    method: body ? 'PUT' : 'GET',
    headers: {
      ...(owner ? { cookie: `lease-loop-provider=${owner}` } : {}),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

it('saves, reloads, edits and turns off one threshold using existing ownership and storage', async () => {
  expect((await PUT(request(input, null), undefined)).status).toBe(401);
  expect((await PUT(request({ ...input, minTermMonths: 35 }), undefined)).status).toBe(422);
  const saved = await PUT(request(input), undefined);
  expect(saved.status).toBe(200);
  const view = (await saved.json()).data;
  expect(view.setting).toMatchObject({
    mode: 'simple',
    minTermMonths: 36,
    discountBps: 1000,
    enabled: true,
  });
  expect(view.terms).toEqual([12, 24, 36, 48]);
  expect(view).not.toHaveProperty('example');
  expect((await (await GET(request(), undefined)).json()).data).toEqual(view);
  expect(await rulesForAsset(db, 'ebike-003')).toEqual([]);
  expect((await PUT(request(input), undefined)).status).toBe(409);
  const off = await PUT(
    request({ ...input, enabled: false, expectedRules: view.setting.expectedRules }),
    undefined
  );
  expect(off.status).toBe(200);
  const offView = (await off.json()).data;
  expect(offView.setting.enabled).toBe(false);
  expect(await rulesForAsset(db, 'ebike-005')).toEqual([]);
  expect(
    (await PUT(request({ ...input, expectedRules: offView.setting.expectedRules }), undefined))
      .status
  ).toBe(200);
  expect(await db.discountRule.count()).toBe(1);
});

it('does not silently widen a bounded rule or replace multiple rules; explicit replacement archives history and preserves contracts', async () => {
  const old = await saveDiscountRule(db, OWNER, {
    name: 'Keep this existing label',
    minTermMonths: 24,
    maxTermMonths: 36,
    discountBps: 1000,
    enabled: true,
  });
  const other = await saveDiscountRule(db, OWNER, {
    name: 'Other original offer',
    minTermMonths: 36,
    maxTermMonths: 48,
    discountBps: 500,
    enabled: true,
  });
  const view = await dealerDiscountView(db, OWNER, table);
  expect(view.setting.mode).toBe('legacy');
  const price = priceContract(
    lists,
    table,
    { assetId: 'ebike-005', termMonths: 24, downPaymentCents: 0 },
    '2026-11-06',
    [old, other]
  );
  if (!price.ok) throw new Error('Pricing failed');
  const contract = await db.contract.create({
    data: { id: 'old-signed', actor: 'Existing renter', ...price.price },
  });
  const vat = await loadVatRates(),
    invoices = await generateInvoices(db, contract.id, 'Existing renter', vat);
  await expect(
    saveDealerDiscount(
      db,
      OWNER,
      { ...input, expectedRules: view.setting.expectedRules },
      view.terms
    )
  ).rejects.toMatchObject({ code: 'REPLACEMENT_REQUIRED' });
  expect(await db.discountRule.findUnique({ where: { id: old.id } })).toEqual(old);
  const replacement = await saveDealerDiscount(
    db,
    OWNER,
    { ...input, expectedRules: view.setting.expectedRules, confirmReplacement: true },
    view.terms
  );
  expect(replacement.maxTermMonths).toBe(48);
  expect(await db.discountRule.findUnique({ where: { id: old.id } })).toMatchObject({
    archived: true,
    name: old.name,
    minTermMonths: 24,
    maxTermMonths: 36,
  });
  expect((await dealerDiscountView(db, OWNER, table)).setting.mode).toBe('simple');
  expect(await db.contract.findUnique({ where: { id: contract.id } })).toEqual(contract);
  expect(await generateInvoices(db, contract.id, 'Existing renter', vat)).toEqual(invoices);
});

it('requires confirmation for a single bounded legacy rule and refuses stale cross-provider snapshots', async () => {
  const old = await saveDiscountRule(db, OWNER, {
    name: 'Bounded',
    minTermMonths: 24,
    maxTermMonths: 36,
    discountBps: 1000,
    enabled: true,
  });
  await expect(
    saveDealerDiscount(
      db,
      OWNER,
      { ...input, expectedRules: [{ id: old.id, revision: old.revision }] },
      [12, 24, 36, 48]
    )
  ).rejects.toMatchObject({ code: 'REPLACEMENT_REQUIRED' });
  await expect(
    saveDealerDiscount(
      db,
      'provider-kettu',
      {
        ...input,
        expectedRules: [{ id: old.id, revision: old.revision }],
        confirmReplacement: true,
      },
      [12, 24, 36, 48]
    )
  ).rejects.toMatchObject({ code: 'DISCOUNT_CHANGED' });
  expect(await db.discountRule.findUnique({ where: { id: old.id } })).toEqual(old);
});

it('rolls back setting changes when the audit cannot be saved', async () => {
  const failing = db.$extends({
    query: {
      auditLog: {
        create() {
          throw new Error('audit unavailable');
        },
      },
    },
  });
  await expect(
    saveDealerDiscount(failing as unknown as PrismaClient, OWNER, input, [12, 24, 36, 48])
  ).rejects.toThrow('audit unavailable');
  expect(await db.discountRule.count()).toBe(0);
});
