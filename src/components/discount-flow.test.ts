import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import ItemPage from '@/app/[locale]/items/[assetId]/page';
import ApplyPage from '@/app/[locale]/items/[assetId]/apply/page';
import SignPage from '@/app/[locale]/items/[assetId]/sign/page';
import DiscountsPage from '@/app/[locale]/discounts/page';
import { loadAssets } from '@/data/load';
import { formatEuro } from '@/domain/money';
import { intlLocale } from '@/i18n/locales';
import { seedAssets } from '@/server/assets';
import { seedDealerSide } from '@/server/providers';
import { saveDiscountRule } from '@/server/discount-rules';
import type { PrismaClient } from '@/server/prisma-client';
import { createTestDb } from '../../tests/helpers/test-db';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
const session = vi.hoisted(() => ({ providerId: 'provider-kettu' }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: session.providerId }) }),
}));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  notFound: () => {
    throw new Error('Not found');
  },
}));
vi.mock('@/server/today', () => ({ todayIso: () => '2026-11-05' }));
vi.mock('@/server/demo-session', () => ({ readDemoName: async () => 'Aino' }));
let db: PrismaClient, cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await seedDealerSide(db, assets);
  await saveDiscountRule(db, 'provider-kettu', {
    name: 'Long rentals',
    minTermMonths: 24,
    maxTermMonths: 48,
    discountBps: 1000,
    enabled: true,
  });
});
afterAll(async () => {
  await cleanup();
});

it.each([
  ['item calculator', ItemPage],
  ['application', ApplyPage],
  ['review and sign', SignPage],
] as const)(
  'shows matching original, discount and final amounts in the %s',
  async (_name, page) => {
    const element = await page({
      params: Promise.resolve({ locale: 'en', assetId: 'ebike-003' }),
      searchParams: Promise.resolve({ term: '36', down: '0', start: '2026-11-05' }),
    });
    const html = renderToStaticMarkup(createElement(() => element));
    expect(html).toContain('Original monthly rent, net');
    expect(html).toContain('Monthly rent discount');
    for (const amount of [10730, 1073, 9657])
      expect(html).toContain(formatEuro(amount, intlLocale.en));
  }
);

it('renders creation and editing forms for the selected provider without waiting for a client fetch', async () => {
  const page = await DiscountsPage({
    params: Promise.resolve({ locale: 'en' }),
    searchParams: Promise.resolve({}),
  });
  const html = renderToStaticMarkup(createElement(() => page));
  expect(html).toContain('Your long-term offer');
  expect(html).toContain('Offer 10% off monthly net rent for leases of 24 months or longer.');
  expect(html).toContain('Choose your provider, set a percentage');
});

it('requires selection for an unknown provider instead of displaying another provider’s rules', async () => {
  session.providerId = 'missing-provider';
  const page = await DiscountsPage({
    params: Promise.resolve({ locale: 'en' }),
    searchParams: Promise.resolve({}),
  });
  const html = renderToStaticMarkup(createElement(() => page));
  expect(html).not.toContain('<form');
  expect(html).toContain('Choose a demo provider');
  session.providerId = 'provider-kettu';
});
