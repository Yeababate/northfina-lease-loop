// Card 6 through the real API: Norvi Logistics applies for 1 × ebike-004, but the applicant
// may not sign for the company. The contract waits for the named signatory, then activates.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as signApi } from '@/app/api/contracts/route';
import { POST as signatureApi } from '@/app/api/contracts/[id]/signature/route';
import { POST as invoicesApi } from '@/app/api/contracts/[id]/invoices/route';
import { loadAssets, loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
import { priceContract } from '@/domain/contract-pricing';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { demoNameCookieHeader } from './demo-cookie';
import { seedDemoParticipants } from './demo-participants';
import type { PrismaClient } from './prisma-client';
import { seedDealerSide } from './providers';
import { signatoryOffer } from './signatory';
import { saveDiscountRule } from './discount-rules';
import { ensureDemoUser } from './mock-users';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
const clock = vi.hoisted(() => ({ today: '2026-11-05' }));
vi.mock('@/server/today', () => ({ todayIso: () => clock.today }));

let db: PrismaClient;
let cleanup: () => Promise<void>;
let price: { monthly: number; buyout: number };
let pricingData: {
  lists: Awaited<ReturnType<typeof loadPriceLists>>;
  table: Awaited<ReturnType<typeof loadCoefficientTable>>;
  vatRates: Awaited<ReturnType<typeof loadVatRates>>;
};
const SIGNATORY = 'signatory@norvi.example.com';

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const [lists, table, vatRates] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
  ]);
  pricingData = { lists, table, vatRates };
  const priced = priceContract(
    lists,
    table,
    { assetId: 'ebike-004', termMonths: 36, downPaymentCents: 0 },
    '2026-11-05'
  );
  if (!priced.ok) throw new Error(priced.reason);
  price = { monthly: priced.price.monthlyNetCents, buyout: priced.price.buyoutNetCents };
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  clock.today = '2026-11-05';
  await db.contract.deleteMany();
  await db.discountRule.deleteMany();
  await db.asset.deleteMany();
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await seedDealerSide(db, assets);
  await seedDemoParticipants(db);
});

const json = (url: string, name: string, body: unknown = {}) =>
  new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: demoNameCookieHeader(name) },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function norviApplies() {
  const response = await signApi(
    json('http://localhost/api/contracts', 'norvi', {
      assetId: 'ebike-004',
      termMonths: 36,
      downPaymentCents: 0,
      startOn: '2026-11-05',
      answers: {
        q_customer_type: 'company',
        q_email: 'fleet@norvi.example.com',
        q_business_id: '3299871-7',
        q_company_name: 'Norvi Logistics Oy',
        q_can_sign: 'no',
        q_signatory_email: SIGNATORY,
        q_vat_registered: 'yes',
        q_usage_purpose: 'delivery',
        q_pep: 'no',
      },
      expectedMonthlyNetCents: price.monthly,
      expectedBuyoutNetCents: price.buyout,
      expectedPriceListVersion: 1,
    }),
    undefined
  );
  return { status: response.status, body: await response.json() };
}

describe('scenario 6: waiting for the company signatory', () => {
  it('saves the contract waiting for the signatory: reserved, not active, nothing billed', async () => {
    const { status, body } = await norviApplies();
    expect(status).toBe(201);
    expect(body.data).toMatchObject({ signatoryEmail: SIGNATORY, actor: 'Norvi Logistics Oy' });
    const id = body.data.id as string;
    expect(await db.contractLifecycle.findUnique({ where: { contractId: id } })).toMatchObject({
      status: 'awaiting_signature',
    });
    expect((await db.asset.findUniqueOrThrow({ where: { id: 'ebike-004' } })).status).toBe(
      'reserved'
    );
    const invoices = await invoicesApi(
      json(`http://localhost/api/contracts/${id}/invoices`, 'norvi', { actor: 'Norvi' }),
      ctx(id)
    );
    expect(invoices.status).toBe(409);
    expect(await db.invoice.count()).toBe(0);
  });

  it('only the named signatory can sign, and that makes the lease active', async () => {
    const { body } = await norviApplies();
    const id = body.data.id as string;
    const url = `http://localhost/api/contracts/${id}/signature`;

    const signatory = await ensureDemoUser(db, SIGNATORY);
    const offer = await signatoryOffer(db, signatory, id, clock.today, pricingData);
    if (!offer.ok) throw new Error('Expected a current offer');
    expect(
      (await signatureApi(json(url, 'norvi', { expected: offer.snapshot }), ctx(id))).status
    ).toBe(404);
    const signed = await signatureApi(
      json(url, 'Signatory@Norvi.example.com', { expected: offer.snapshot }),
      ctx(id)
    );
    expect(signed.status).toBe(200);
    expect((await signed.json()).data).toMatchObject({
      signatorySignedOn: '2026-11-05',
      lockedPriceListVersion: 1,
      lifecycle: { status: 'active' },
    });
    // A second signature changes nothing.
    expect(
      (await signatureApi(json(url, SIGNATORY, { expected: offer.snapshot }), ctx(id))).status
    ).toBe(409);
    expect(await db.auditLog.count({ where: { action: 'contract.signatory_signed' } })).toBe(1);
  });

  it('requires a fresh offer review when pricing changes while the contract waits', async () => {
    const { body } = await norviApplies();
    const id = body.data.id as string;
    const signatory = await ensureDemoUser(db, SIGNATORY);
    const oldOffer = await signatoryOffer(db, signatory, id, clock.today, pricingData);
    if (!oldOffer.ok) throw new Error('Expected a current offer');
    const owner = await db.assetOwnership.findUniqueOrThrow({ where: { assetId: 'ebike-004' } });
    await saveDiscountRule(db, owner.providerId, {
      name: 'Waiting-signature offer update',
      minTermMonths: 12,
      maxTermMonths: 48,
      discountBps: 1000,
      enabled: true,
    });
    const url = `http://localhost/api/contracts/${id}/signature`;
    const stale = await signatureApi(
      json(url, SIGNATORY, { expected: oldOffer.snapshot }),
      ctx(id)
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe('PRICE_CHANGED');
    expect(
      await db.contractLifecycle.findUniqueOrThrow({ where: { contractId: id } })
    ).toMatchObject({
      status: 'awaiting_signature',
    });
    expect(await db.contract.findUniqueOrThrow({ where: { id } })).toMatchObject({
      lockedPriceListVersion: null,
      monthlyNetCents: price.monthly,
    });
    const currentOffer = await signatoryOffer(db, signatory, id, clock.today, pricingData);
    if (!currentOffer.ok) throw new Error('Expected the updated offer');
    const accepted = await signatureApi(
      json(url, SIGNATORY, { expected: currentOffer.snapshot }),
      ctx(id)
    );
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).data).toMatchObject({
      monthlyNetCents: currentOffer.snapshot.monthlyNetCents,
      monthlyDiscountCents: currentOffer.snapshot.monthlyDiscountCents,
      discountBps: 1000,
      lockedPriceListVersion: 1,
      lifecycle: { status: 'active' },
    });
  });
});
