// Runs against a real, migrated SQLite database (see tests/global-setup.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAssets } from '@/data/load';
import { createTestDb } from '../../../../../../tests/helpers/test-db';
import { seedAssets } from '@/server/assets';
import type { PrismaClient } from '@/server/prisma-client';
import { GET } from './route';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
// The last day of price list 1, where the worked example's €3,890.00 applies.
vi.mock('@/server/today', () => ({ todayIso: () => '2026-11-05' }));

let db: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.asset.deleteMany();
  await seedAssets(db, await loadAssets());
});

const get = async (id: string, search: string) => {
  const response = await GET(new Request(`http://test/api/assets/${id}/compare?${search}`), {
    params: Promise.resolve({ id }),
  });
  return { status: response.status, body: await response.json() };
};

describe('GET /api/assets/:id/compare', () => {
  it('compares options side by side, ready for the UI', async () => {
    const { status, body } = await get('ebike-003', 'options=24:0,36:0');
    expect(status).toBe(200);
    expect(body.data.listPriceCents).toBe(389_000);
    expect(body.data.startOn).toBe('2026-11-05');
    expect(body.data.options).toHaveLength(2);
    expect(body.data.options[1].breakdown.quote.monthlyNetCents).toBe(10_730);
    expect(body.data.lowestMonthly).toBe(1);
  });

  it('returns a reason for an option that cannot be leased', async () => {
    const { body } = await get('ebike-003', 'options=36:0,30:0');
    expect(body.data.options[1]).toMatchObject({ ok: false, reason: 'unknown_term' });
  });

  it('rejects a malformed or too long list, a past start and an unknown item', async () => {
    expect((await get('ebike-003', 'options=36')).status).toBe(400);
    expect((await get('ebike-003', 'options=12:0,24:0,36:0,48:0,12:0')).status).toBe(400);
    expect((await get('ebike-003', 'options=24:0,36:0&start=2026-01-01')).status).toBe(400);
    expect((await get('no-such-item', 'options=24:0,36:0')).status).toBe(404);
  });
});
