import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import LeasePage from '@/app/[locale]/lease/[id]/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('Not found');
  },
}));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('@/server/today', () => ({ todayIso: () => '2026-11-05' }));
vi.mock('@/server/db', () => ({
  db: {
    assetOwnership: { findUnique: async () => null },
    asset: {
      findUnique: async () => ({
        id: 'farm-006',
        make: 'Test',
        model: 'Machine',
        status: 'available',
      }),
    },
  },
}));

async function render(searchParams: Record<string, string>) {
  const page = await LeasePage({
    params: Promise.resolve({ locale: 'en', id: 'farm-006' }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(createElement(() => page));
}

it('carries the selected term and down payment from the URL into the signing form', async () => {
  const html = await render({ term: '48', down: '2000000' });
  expect(html).toContain('<option value="48" selected="">');
  expect(html).toContain('value="2000000"');
  expect(html).toContain('Enter your name');
  expect(html).not.toContain('The financed amount exceeds the maximum');
  expect(html).toContain('aria-describedby=');
});

it('defaults to the minimum viable down payment for direct signing links', async () => {
  const html = await render({});
  expect(html).toContain('value="1000000"');
  expect(html).toContain('Enter your name');
});

it('explains a supplied unpriceable lease instead of silently changing its price inputs', async () => {
  const html = await render({ term: '48', down: '0' });
  expect(html).toContain('The financed amount exceeds the maximum. Increase the down payment.');
  expect(html).toContain('disabled=""');
});

it('keeps malformed query input blocked with a field-specific explanation', async () => {
  expect(await render({ down: 'invalid' })).toContain('Enter a down payment in whole euro cents');
});
