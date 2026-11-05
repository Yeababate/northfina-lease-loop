import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/contracts/route';
import {
  loadAssets,
  loadCoefficientTable,
  loadPriceLists,
  loadQuestions,
  loadVatRates,
} from '@/data/load';
import { quoteLease } from '@/domain/pricing';
import { priceContract } from '@/domain/contract-pricing';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { signApplication, signContract, type SigningData } from './contracts';
import type { PrismaClient } from './prisma-client';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
vi.mock('@/server/today', () => ({ todayIso: () => '2026-11-05' }));
// No demo name in these tests: signing saves no reminder settings, as before reminders existed.
vi.mock('@/server/demo-session', () => ({ readDemoName: async () => null }));

let db: PrismaClient;
let cleanup: () => Promise<void>;
let lists: Awaited<ReturnType<typeof loadPriceLists>>;
let table: Awaited<ReturnType<typeof loadCoefficientTable>>;
const input = {
  assetId: 'ebike-003',
  actor: 'cust-aino',
  termMonths: 36,
  downPaymentCents: 0,
  expectedMonthlyNetCents: 10730,
  expectedPriceListVersion: 1,
};
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  [lists, table] = await Promise.all([loadPriceLists(), loadCoefficientTable()]);
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.contract.deleteMany();
  await db.auditLog.deleteMany();
  await db.asset.deleteMany();
  await seedAssets(db, await loadAssets());
  await db.auditLog.deleteMany();
});
it('persists the full snapshot and audit, reserves the item and rejects repeat signing', async () => {
  const contract = await signContract(db, input, '2026-11-05', lists, table);
  const slider = quoteLease(table, {
    listPriceCents: lists[0]!.prices[input.assetId]!,
    downPaymentCents: input.downPaymentCents,
    termMonths: input.termMonths,
    vatRatePercent: 25.5,
  });
  expect(slider.ok).toBe(true);
  if (!slider.ok) throw new Error('Slider pricing failed');
  expect(contract.monthlyNetCents).toBe(slider.quote.monthlyNetCents);
  expect(contract.buyoutNetCents).toBe(slider.quote.buyoutCents);
  expect(contract).toMatchObject({
    monthlyNetCents: 10730,
    buyoutNetCents: 58350,
    signedOn: '2026-11-05',
    endOn: '2029-11-05',
    actor: 'cust-aino',
  });
  expect(await db.asset.findUnique({ where: { id: input.assetId } })).toMatchObject({
    status: 'reserved',
  });
  const audit = await db.auditLog.findFirstOrThrow();
  expect(audit).toMatchObject({
    action: 'contract.signed',
    entity_id: contract.id,
    actor: input.actor,
  });
  expect(JSON.parse(audit.details_json!)).toMatchObject({
    monthlyNetCents: 10730,
    priceListVersion: 1,
  });
  await expect(signContract(db, input, '2026-11-05', lists, table)).rejects.toMatchObject({
    code: 'ASSET_UNAVAILABLE',
  });
  expect(await db.contract.count()).toBe(1);
  expect(await db.auditLog.count()).toBe(1);
});
it('reads the same stored price after both catalogue and coefficient changes', async () => {
  const contract = await signContract(db, input, '2026-11-05', lists, table);
  const changed = structuredClone(lists);
  changed[0]!.prices[input.assetId] = 500000;
  const changedTable = structuredClone(table);
  changedTable.bands[1]!.monthly_factor_by_term['36'] = 0.05;
  expect(priceContract(changed, changedTable, input, '2026-11-05')).toMatchObject({
    ok: true,
    price: { monthlyNetCents: 25000 },
  });
  expect(await db.contract.findUnique({ where: { id: contract.id } })).toEqual(contract);
});
it('requires renewed consent for a stale quote on the next day', async () => {
  await expect(signContract(db, input, '2026-11-06', lists, table)).rejects.toMatchObject({
    code: 'PRICE_CHANGED',
  });
  expect(await db.contract.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
});
it('rejects invalid pricing and unknown assets without writes', async () => {
  await expect(
    signContract(db, { ...input, downPaymentCents: -1 }, '2026-11-05', lists, table)
  ).rejects.toMatchObject({ code: 'INVALID_PRICE' });
  const withMissing = structuredClone(lists);
  withMissing[0]!.prices.missing = 389000;
  await expect(
    signContract(db, { ...input, assetId: 'missing' }, '2026-11-05', withMissing, table)
  ).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  expect(await db.auditLog.count()).toBe(0);
});
it('rolls back contract and reservation if the audit insert fails', async () => {
  // A transaction client uses the same model extension as the outer client.
  const failingDb = db.$extends({
    query: {
      auditLog: {
        create() {
          throw new Error('audit unavailable');
        },
      },
    },
  });
  await expect(
    signContract(failingDb as unknown as PrismaClient, input, '2026-11-05', lists, table)
  ).rejects.toThrow('audit unavailable');
  expect(await db.contract.count()).toBe(0);
  expect(await db.asset.findUnique({ where: { id: input.assetId } })).toMatchObject({
    status: 'available',
  });
  expect(await db.auditLog.count()).toBe(0);
});

// A complete, approvable application for scenario card 1 (ebike-003, 36 months).
const aino = {
  q_customer_type: 'consumer',
  q_full_name: 'Aino Virtanen',
  q_birth_date: '1992-03-14',
  q_email: 'aino@example.com',
  q_country: 'FI',
  q_employment: 'employed',
  q_monthly_income: 320000,
  q_usage_purpose: 'commuting',
};
const application = {
  assetId: 'ebike-003',
  termMonths: 36,
  downPaymentCents: 0,
  startOn: '2026-11-05',
  answers: aino,
  expectedMonthlyNetCents: 10730,
  expectedPriceListVersion: 1,
};

describe('signApplication', () => {
  let data: SigningData;
  beforeAll(async () => {
    const [vatRates, questionsFile] = await Promise.all([loadVatRates(), loadQuestions()]);
    data = { lists, table, vatRates, questions: questionsFile.questions };
  });

  it("signs an approved application in the applicant's name, from the chosen start date", async () => {
    const contract = await signApplication(
      db,
      { ...application, startOn: '2026-12-01' },
      '2026-11-05',
      data
    );
    expect(contract).toMatchObject({
      actor: 'Aino Virtanen',
      monthlyNetCents: 10730,
      signedOn: '2026-11-05',
      startOn: '2026-12-01',
      endOn: '2029-12-01',
    });
  });

  it('refuses a declined application and writes nothing (scenario card 5)', async () => {
    const tooYoung = { ...application, answers: { ...aino, q_birth_date: '2009-06-01' } };
    await expect(signApplication(db, tooYoung, '2026-11-05', data)).rejects.toMatchObject({
      status: 422,
      code: 'NOT_APPROVED',
    });
    expect(await db.contract.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it('refuses an application with questions still open', async () => {
    const { q_usage_purpose: _open, ...partial } = aino;
    await expect(
      signApplication(db, { ...application, answers: partial }, '2026-11-05', data)
    ).rejects.toMatchObject({ code: 'NOT_APPROVED', details: 'incomplete' });
  });

  it('refuses unknown items and leases that cannot be priced', async () => {
    await expect(
      signApplication(db, { ...application, assetId: 'nope' }, '2026-11-05', data)
    ).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    await expect(
      signApplication(db, { ...application, startOn: '2026-11-04' }, '2026-11-05', data)
    ).rejects.toMatchObject({ code: 'INVALID_PRICE', details: 'start_before_signing' });
    const noVat = { ...data, vatRates: { ...data.vatRates, rates: [] } };
    await expect(signApplication(db, application, '2026-11-05', noVat)).rejects.toMatchObject({
      code: 'INVALID_PRICE',
      details: 'no_rate_on_date',
    });
  });

  it('keeps the price-changed check: a quote from list 1 cannot sign on list 2 day', async () => {
    // Laptops are not e-bikes, so the usage question does not apply.
    const { q_usage_purpose: _bikeOnly, ...laptopAnswers } = aino;
    const laptop = {
      ...application,
      assetId: 'laptop-004',
      startOn: '2026-11-06',
      answers: laptopAnswers,
    };
    await expect(signApplication(db, laptop, '2026-11-06', data)).rejects.toMatchObject({
      code: 'PRICE_CHANGED',
    });
  });
});

it('signing API checks the application and returns the shared response envelope', async () => {
  const request = (body: unknown) =>
    new Request('http://localhost/api/contracts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  // A typed-in signer name is no longer accepted: the name comes from the application.
  const withActor = await POST(request({ ...application, actor: 'anyone' }), undefined);
  expect(withActor.status).toBe(400);
  expect(await withActor.json()).toMatchObject({
    success: false,
    error: { code: 'VALIDATION_ERROR' },
  });
  const fractional = await POST(request({ ...application, downPaymentCents: 0.5 }), undefined);
  expect(fractional.status).toBe(400);
  const declined = await POST(
    request({ ...application, answers: { ...aino, q_country: 'other' } }),
    undefined
  );
  expect(declined.status).toBe(422);
  expect(await declined.json()).toMatchObject({ error: { code: 'NOT_APPROVED' } });
  const signed = await POST(request(application), undefined);
  expect(signed.status).toBe(201);
  expect(await signed.json()).toMatchObject({
    success: true,
    data: { monthlyNetCents: 10730, signedOn: '2026-11-05', actor: 'Aino Virtanen' },
    meta: { timestamp: expect.any(String) },
  });
  const duplicate = await POST(request(application), undefined);
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toMatchObject({
    success: false,
    error: { code: 'ASSET_UNAVAILABLE' },
  });
});
