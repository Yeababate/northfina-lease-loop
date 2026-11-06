import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/discount-rules/route';
import { PATCH } from '@/app/api/discount-rules/[id]/route';
import {
  loadAssets,
  loadCoefficientTable,
  loadPriceLists,
  loadQuestions,
  loadVatRates,
} from '@/data/load';
import { quoteLease } from '@/domain/pricing';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { seedDealerSide } from './providers';
import { saveDiscountRule, rulesForAsset } from './discount-rules';
import { signApplication, type SigningData } from './contracts';
import { generateInvoices } from './invoices';
import type { PrismaClient } from './prisma-client';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
let db: PrismaClient, cleanup: () => Promise<void>, data: SigningData;
const ruleInput = {
  name: 'Long rental',
  minTermMonths: 24,
  maxTermMonths: 48,
  discountBps: 1000,
  enabled: true,
};
const KETTU = 'provider-kettu',
  PELTO = 'provider-pelto';
const answers = {
  q_customer_type: 'consumer',
  q_full_name: 'Aino Virtanen',
  q_birth_date: '1992-03-14',
  q_email: 'aino@example.com',
  q_country: 'FI',
  q_employment: 'employed',
  q_monthly_income: 320000,
  q_usage_purpose: 'commuting',
};
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const [lists, table, vatRates, questions] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
    loadQuestions(),
  ]);
  data = { lists, table, vatRates, questions: questions.questions };
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await seedDealerSide(db, assets);
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.invoice.deleteMany();
  await db.contractProvider.deleteMany();
  await db.contract.deleteMany();
  await db.discountRule.deleteMany();
  await db.auditLog.deleteMany();
  await db.asset.update({ where: { id: 'ebike-003' }, data: { status: 'available' } });
});
const request = (providerId: string | null, body?: unknown) =>
  new Request('http://localhost/api/discount-rules', {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(providerId ? { cookie: `lease-loop-provider=${providerId}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

it('creates, lists and updates only the selected dealer’s rules with optimistic revisions and audit', async () => {
  expect((await POST(request(null, ruleInput), undefined)).status).toBe(401);
  expect((await POST(request(KETTU, { ...ruleInput, discountBps: 10001 }), undefined)).status).toBe(
    400
  );
  const created = await POST(request(KETTU, ruleInput), undefined);
  expect(created.status).toBe(201);
  const rule = (await created.json()).data;
  expect(rule).toMatchObject({ providerId: KETTU, revision: 1 });
  expect((await (await GET(request(PELTO), undefined)).json()).data).toEqual([]);
  const context = { params: Promise.resolve({ id: rule.id }) };
  expect((await PATCH(request(PELTO, { rule: ruleInput, revision: 1 }), context)).status).toBe(404);
  const updated = await PATCH(
    request(KETTU, { rule: { ...ruleInput, discountBps: 1500 }, revision: 1 }),
    context
  );
  expect(updated.status).toBe(200);
  expect((await updated.json()).data).toMatchObject({ revision: 2, discountBps: 1500 });
  expect((await PATCH(request(KETTU, { rule: ruleInput, revision: 1 }), context)).status).toBe(409);
  expect(await db.auditLog.count()).toBe(2);
  expect((await rulesForAsset(db, 'ebike-003'))[0]?.id).toBe(rule.id);
  expect(await rulesForAsset(db, 'farm-002')).toEqual([]);
  expect(await rulesForAsset(db, 'missing')).toEqual([]);
});

async function offer() {
  const rules = await rulesForAsset(db, 'ebike-003');
  const priced = quoteLease(
    data.table,
    { listPriceCents: 389000, termMonths: 36, downPaymentCents: 0, vatRatePercent: 25.5 },
    rules
  );
  if (!priced.ok) throw new Error('Pricing failed');
  return {
    quote: priced.quote,
    input: {
      assetId: 'ebike-003',
      termMonths: 36,
      downPaymentCents: 0,
      startOn: '2026-12-31',
      answers,
      expectedMonthlyNetCents: priced.quote.monthlyNetCents,
      expectedBuyoutNetCents: priced.quote.buyoutCents,
      expectedPriceListVersion: 1,
      expectedDiscountRuleId: priced.quote.discountRuleId,
      expectedDiscountRuleRevision: priced.quote.discountRuleRevision,
    },
  };
}

it('locks the shared discounted quote, applied rule and original price; later edits cannot alter contracts or invoices', async () => {
  const rule = await saveDiscountRule(db, KETTU, ruleInput);
  const preview = await offer();
  const contract = await signApplication(db, preview.input, '2026-11-05', data);
  expect(contract).toMatchObject({
    monthlyNetCents: preview.quote.monthlyNetCents,
    originalMonthlyNetCents: 10730,
    monthlyDiscountCents: 1073,
    discountRuleId: rule.id,
    discountRuleRevision: 1,
    discountBps: 1000,
    buyoutNetCents: preview.quote.buyoutCents,
  });
  expect(
    await db.contractProvider.findUnique({ where: { contractId: contract.id } })
  ).toMatchObject({ providerId: KETTU });
  const invoices = await generateInvoices(db, contract.id, 'Aino', data.vatRates);
  expect(invoices[0]).toMatchObject({ netCents: 9657, vatPercent: 25.5 });
  expect(invoices[1]).toMatchObject({ netCents: 9657, vatPercent: 26 });
  await saveDiscountRule(
    db,
    KETTU,
    { ...ruleInput, discountBps: 2500, enabled: false },
    { id: rule.id, revision: 1 }
  );
  expect(await db.contract.findUnique({ where: { id: contract.id } })).toEqual(contract);
  expect(await generateInvoices(db, contract.id, 'Aino', data.vatRates)).toEqual(invoices);
});

it('detects rule revisions even when discount rounding leaves the offered rent unchanged', async () => {
  const rule = await saveDiscountRule(db, KETTU, { ...ruleInput, discountBps: 1 });
  const previous = await offer();
  await saveDiscountRule(
    db,
    KETTU,
    { ...ruleInput, discountBps: 1, name: 'Revised terms' },
    { id: rule.id, revision: 1 }
  );
  const current = await offer();
  expect(current.quote.monthlyNetCents).toBe(previous.quote.monthlyNetCents);
  await expect(signApplication(db, previous.input, '2026-11-05', data)).rejects.toMatchObject({
    code: 'PRICE_CHANGED',
  });
  expect(await db.contract.count()).toBe(0);
  await expect(
    signApplication(db, { ...current.input, answers: {} }, '2026-11-05', data)
  ).rejects.toMatchObject({ code: 'NOT_APPROVED' });
  await expect(signApplication(db, current.input, '2026-11-05', data)).resolves.toMatchObject({
    discountRuleRevision: 2,
  });
});

it('requires refreshed consent when a discount appears or disappears and leaves older undiscounted contracts unchanged', async () => {
  const undiscounted = await offer();
  const rule = await saveDiscountRule(db, KETTU, ruleInput);
  await expect(signApplication(db, undiscounted.input, '2026-11-05', data)).rejects.toMatchObject({
    code: 'PRICE_CHANGED',
  });
  const discounted = await offer();
  await saveDiscountRule(db, KETTU, { ...ruleInput, enabled: false }, { id: rule.id, revision: 1 });
  await expect(signApplication(db, discounted.input, '2026-11-05', data)).rejects.toMatchObject({
    code: 'PRICE_CHANGED',
  });
  const contract = await signApplication(db, undiscounted.input, '2026-11-05', data);
  await saveDiscountRule(db, KETTU, ruleInput, { id: rule.id, revision: 2 });
  expect(await db.contract.findUnique({ where: { id: contract.id } })).toEqual(contract);
  expect((await generateInvoices(db, contract.id, 'Aino', data.vatRates))[0]?.netCents).toBe(10730);
});

it('rolls back dealer edits if audit persistence fails', async () => {
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
    saveDiscountRule(failing as unknown as PrismaClient, KETTU, ruleInput)
  ).rejects.toThrow('audit unavailable');
  expect(await db.discountRule.count()).toBe(0);
});

it('refuses a rule for a provider that does not exist, without an audit row', async () => {
  await db.auditLog.deleteMany();
  await expect(saveDiscountRule(db, 'provider-gone', ruleInput)).rejects.toMatchObject({
    status: 401,
    code: 'PROVIDER_REQUIRED',
  });
  expect(await db.discountRule.count({ where: { providerId: 'provider-gone' } })).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
});
