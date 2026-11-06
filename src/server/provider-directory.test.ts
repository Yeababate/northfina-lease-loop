import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DiscountsPage from '@/app/[locale]/discounts/page';
import { GET as directory } from '@/app/api/providers/route';
import { GET as session, POST as selectProvider } from '@/app/api/provider-session/route';
import { GET as listDiscounts, POST as createDiscount } from '@/app/api/discount-rules/route';
import { loadAssets, loadCoefficientTable, loadPriceLists } from '@/data/load';
import { quoteLease } from '@/domain/pricing';
import { listPriceOn } from '@/domain/price-list';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { listProviders } from './providers';
import { rulesForAsset } from './discount-rules';
import type { PrismaClient } from './prisma-client';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
const selection = vi.hoisted(() => ({ id: 'existing-west' }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: selection.id }) }),
}));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('Not found');
  },
}));
let db: PrismaClient, cleanup: () => Promise<void>;
const FIRST = 'existing-east',
  SECOND = 'existing-west';
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  await seedAssets(db, await loadAssets());
  // Existing providers may share a display name: their stable IDs must stay distinct.
  await db.provider.createMany({
    data: [
      { id: FIRST, displayName: 'Existing provider' },
      { id: SECOND, displayName: 'Existing provider' },
    ],
  });
  await db.assetOwnership.createMany({
    data: [
      { assetId: 'ebike-003', providerId: FIRST, source: 'transfer' },
      { assetId: 'ebike-004', providerId: SECOND, source: 'transfer' },
    ],
  });
});
afterAll(async () => {
  await cleanup();
});
const request = (id: string, body?: unknown) =>
  new Request('http://localhost/api', {
    method: body ? 'POST' : 'GET',
    headers: {
      cookie: `lease-loop-provider=${encodeURIComponent(id)}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

it('uses persisted provider records for the directory and session, without inventing demo identities or matching names', async () => {
  const existing = await db.provider.findMany({ orderBy: { id: 'asc' } });
  expect(await listProviders(db)).toEqual(existing);
  expect((await (await directory(request(FIRST), undefined)).json()).data).toEqual(existing);
  expect(
    (await selectProvider(request(FIRST, { providerId: 'Existing provider' }), undefined)).status
  ).toBe(404);
  const selected = await selectProvider(request(FIRST, { providerId: SECOND }), undefined);
  expect(selected.status).toBe(200);
  expect((await selected.json()).data.id).toBe(SECOND);
  expect((await (await session(request(SECOND), undefined)).json()).data.id).toBe(SECOND);
  expect(await db.provider.count()).toBe(2);
});

it('applies a saved discount only to the selected provider’s inventory even when names are identical', async () => {
  const response = await createDiscount(
    request(FIRST, {
      name: 'Existing provider',
      minTermMonths: 24,
      maxTermMonths: 48,
      discountBps: 1000,
      enabled: true,
    }),
    undefined
  );
  expect(response.status).toBe(201);
  const saved = (await response.json()).data;
  expect(saved.providerId).toBe(FIRST);
  expect((await (await listDiscounts(request(SECOND), undefined)).json()).data).toEqual([]);
  const [table, lists] = await Promise.all([loadCoefficientTable(), loadPriceLists()]);
  for (const [assetId, discounted] of [
    ['ebike-003', true],
    ['ebike-004', false],
  ] as const) {
    const price = listPriceOn(lists, assetId, '2026-11-05');
    if (!price.ok) throw new Error('Price missing');
    const input = {
      listPriceCents: price.priceCents,
      termMonths: 36,
      downPaymentCents: 0,
      vatRatePercent: 25.5,
    };
    const original = quoteLease(table, input);
    const quote = quoteLease(table, input, await rulesForAsset(db, assetId));
    if (!original.ok || !quote.ok) throw new Error('Quote failed');
    expect(quote.quote.discountRuleId).toBe(discounted ? saved.id : null);
    expect(quote.quote.monthlyDiscountCents > 0).toBe(discounted);
    if (!discounted) expect(quote.quote.monthlyNetCents).toBe(original.quote.monthlyNetCents);
  }
  await db.provider.update({
    where: { id: FIRST },
    data: { displayName: 'Updated existing name' },
  });
  expect((await listProviders(db)).find((provider) => provider.id === FIRST)?.displayName).toBe(
    'Updated existing name'
  );
  expect((await rulesForAsset(db, 'ebike-003'))[0]?.providerId).toBe(FIRST);
  expect(await db.assetOwnership.findUnique({ where: { assetId: 'ebike-003' } })).toMatchObject({
    providerId: FIRST,
  });
  expect(await db.provider.count()).toBe(2);
});

it('does not apply orphaned rule/ownership links or silently repair them by a similar display name', async () => {
  await db.assetOwnership.create({
    data: { assetId: 'laptop-001', providerId: 'missing-provider', source: 'transfer' },
  });
  await db.discountRule.create({
    data: {
      id: 'unresolved-rule',
      providerId: 'missing-provider',
      name: 'Existing provider',
      minTermMonths: 24,
      maxTermMonths: 48,
      discountBps: 1000,
      enabled: true,
    },
  });
  expect(await rulesForAsset(db, 'laptop-001')).toEqual([]);
  expect(await db.provider.count()).toBe(2);
  expect(await db.discountRule.findUnique({ where: { id: 'unresolved-rule' } })).toMatchObject({
    providerId: 'missing-provider',
  });
});

it('renders the selector from the same records as the directory and shows only the selected provider’s rules', async () => {
  const page = await DiscountsPage({
    params: Promise.resolve({ locale: 'en' }),
    searchParams: Promise.resolve({}),
  });
  const html = renderToStaticMarkup(createElement(() => page));
  const providers = (await (await directory(request(SECOND), undefined)).json()).data as {
    id: string;
    displayName: string;
  }[];
  for (const provider of providers) {
    expect(html).toContain(`value="${provider.id}"`);
    expect(html).toContain(provider.displayName);
  }
  expect(html).toContain('Your long-term offer');
  expect(html).not.toContain('name="name"');
  expect(html).not.toContain('name="maxTermMonths"');
  expect(await db.provider.count()).toBe(2);
});
