// Scenario card 6 through the real signing API: Norvi Logistics applies for 4 × ebike-004.
// The lot is priced as one lease on the total, and the applicant may not sign for the company.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/contracts/route';
import { loadAssets, loadCoefficientTable, loadPriceLists } from '@/data/load';
import { priceContract } from '@/domain/contract-pricing';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { demoNameCookieHeader } from './demo-cookie';
import { seedDemoParticipants } from './demo-participants';
import type { PrismaClient } from './prisma-client';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
vi.mock('@/server/today', () => ({ todayIso: () => '2026-11-05' }));

let db: PrismaClient;
let cleanup: () => Promise<void>;
let expected: { monthly: number; buyout: number };

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const [lists, table] = await Promise.all([loadPriceLists(), loadCoefficientTable()]);
  const price = priceContract(
    lists,
    table,
    { assetId: 'ebike-004', termMonths: 36, downPaymentCents: 0, quantity: 4 },
    '2026-11-05'
  );
  if (!price.ok) throw new Error(price.reason);
  expected = { monthly: price.price.monthlyNetCents, buyout: price.price.buyoutNetCents };
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.contract.deleteMany();
  await db.asset.deleteMany();
  await seedAssets(db, await loadAssets());
  await seedDemoParticipants(db);
});

const norvi = (canSign: boolean, quantity = 4) => ({
  assetId: 'ebike-004',
  quantity,
  termMonths: 36,
  downPaymentCents: 0,
  startOn: '2026-11-05',
  answers: {
    q_customer_type: 'company',
    q_email: 'fleet@norvi.example.com',
    q_business_id: '3299871-7',
    q_company_name: 'Norvi Logistics Oy',
    q_can_sign: canSign ? 'yes' : 'no',
    ...(canSign ? {} : { q_signatory_email: 'signatory@norvi.example.com' }),
    q_vat_registered: 'yes',
    q_usage_purpose: 'delivery',
    q_pep: 'no',
  },
  expectedMonthlyNetCents: expected.monthly,
  expectedBuyoutNetCents: expected.buyout,
  expectedPriceListVersion: 1,
});

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/contracts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: demoNameCookieHeader('norvi') },
      body: JSON.stringify(body),
    }),
    undefined
  );

describe('scenario 6: 4 × ebike-004 for Norvi', () => {
  it('refuses to let the applicant sign: only the company signatory can', async () => {
    const response = await post(norvi(false));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'SIGNATORY_REQUIRED' } });
    expect(await db.contract.count()).toBe(0);
  });

  it('signs the whole lot as one lease when the applicant may sign', async () => {
    const response = await post(norvi(true));
    expect(response.status).toBe(201);
    const { data } = (await response.json()) as {
      data: { quantity: number; listPriceCents: number; financedCents: number };
    };
    expect(data).toMatchObject({
      quantity: 4,
      listPriceCents: 2_196_000,
      financedCents: 2_196_000,
    });
  });

  it('rejects a quantity outside 1–10', async () => {
    expect((await post(norvi(true, 11))).status).toBe(400);
  });
});
