import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { POST as sign } from '@/app/api/contracts/route';
import { GET as list, POST as generate } from '@/app/api/contracts/[id]/invoices/route';
import {
  loadAssets,
  loadCoefficientTable,
  loadPriceLists,
  loadQuestions,
  loadVatRates,
} from '@/data/load';
import { parseCatalogueQuery } from '@/domain/catalogue';
import { quoteLease, availableTerms } from '@/domain/pricing';
import { listPriceOn } from '@/domain/price-list';
import { vatRateOn } from '@/domain/vat';
import { checkApplicationForSigning } from '@/domain/application-signing';
import type { Answers } from '@/domain/answer-check';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { signApplication, type SigningData } from './contracts';
import type { PrismaClient } from './prisma-client';

const clock = vi.hoisted(() => ({ today: '2026-01-01' }));
vi.mock('@/server/today', () => ({ todayIso: () => clock.today }));
vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
let db: PrismaClient;
let cleanup: () => Promise<void>;
let data: SigningData;
const answers: Answers = {
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
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  clock.today = '2026-01-01';
  await db.invoice.deleteMany();
  await db.contract.deleteMany();
  await db.auditLog.deleteMany();
  await db.asset.deleteMany();
  await seedAssets(db, await loadAssets());
  await db.auditLog.deleteMany();
});

function preview(assetId = 'ebike-003', start = '2026-01-31', quotedOn = clock.today) {
  const choices = parseCatalogueQuery(
    { term: '36', start },
    { today: quotedOn, terms: availableTerms(data.table), defaultTerm: 36 }
  );
  const price = listPriceOn(data.lists, assetId, quotedOn);
  const vat = vatRateOn(data.vatRates.rates, choices.startDate);
  if (!price.ok || !vat.ok) throw new Error('Fixture pricing unavailable');
  const result = quoteLease(data.table, {
    listPriceCents: price.priceCents,
    termMonths: choices.termMonths,
    downPaymentCents: 0,
    vatRatePercent: vat.rate.rate_percent,
  });
  if (!result.ok) throw new Error('Fixture quote unavailable');
  return {
    quote: result.quote,
    input: {
      assetId,
      termMonths: choices.termMonths,
      downPaymentCents: 0,
      startOn: choices.startDate,
      answers: assetId.startsWith('laptop')
        ? Object.fromEntries(Object.entries(answers).filter(([key]) => key !== 'q_usage_purpose'))
        : answers,
      expectedMonthlyNetCents: result.quote.monthlyNetCents,
      expectedBuyoutNetCents: result.quote.buyoutCents,
      expectedPriceListVersion: price.priceListVersion,
    },
  };
}
const request = (body: unknown) =>
  new Request('http://localhost/api/contracts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

it('connects slider choices, approval, signing, saved start, VAT invoices and exact totals', async () => {
  const { quote, input } = preview();
  expect(
    checkApplicationForSigning({
      questions: data.questions,
      coefficientTable: data.table,
      answers: input.answers,
      deal: {
        category: 'e_bike',
        financedAmountCents: quote.financedCents,
        termMonths: input.termMonths,
        startDate: input.startOn,
      },
      monthlyRentWithVatCents: quote.monthlyGrossCents,
    })
  ).toMatchObject({ ok: true });
  const signed = await sign(request(input), undefined);
  expect(signed.status).toBe(201);
  const contract = (await signed.json()).data;
  expect(contract).toMatchObject({
    monthlyNetCents: quote.monthlyNetCents,
    buyoutNetCents: quote.buyoutCents,
    signedOn: '2026-01-01',
    startOn: '2026-01-31',
    endOn: '2029-01-31',
  });
  expect(await db.contract.findUnique({ where: { id: contract.id } })).toEqual(contract);
  const context = { params: Promise.resolve({ id: contract.id }) };
  const response = await generate(request({ actor: 'Aino Virtanen' }), context);
  expect(response.status).toBe(200);
  const invoices = (await response.json()).data as {
    invoiceDate: string;
    netCents: number;
    vatCents: number;
    grossCents: number;
    vatPercent: number;
  }[];
  expect(invoices).toHaveLength(36);
  expect(invoices[0]?.invoiceDate).toBe('2026-01-31');
  expect(invoices[1]?.invoiceDate).toBe('2026-02-28');
  expect(invoices[2]?.invoiceDate).toBe('2026-03-31');
  expect(invoices[25]?.invoiceDate).toBe('2028-02-29');
  expect(invoices[26]?.invoiceDate).toBe('2028-03-31');
  expect(invoices[11]).toMatchObject({
    invoiceDate: '2026-12-31',
    vatPercent: 25.5,
    netCents: quote.monthlyNetCents,
  });
  expect(invoices[12]).toMatchObject({
    invoiceDate: '2027-01-31',
    vatPercent: 26,
    netCents: quote.monthlyNetCents,
  });
  expect(invoices.reduce((sum, row) => sum + row.netCents, 0)).toBe(quote.totalNetCents);
  expect(
    invoices.every(
      (row) =>
        Number.isInteger(row.netCents) &&
        Number.isInteger(row.vatCents) &&
        row.grossCents === row.netCents + row.vatCents
    )
  ).toBe(true);
  const repeated = await generate(request({ actor: 'Aino Virtanen' }), context);
  expect((await repeated.json()).data).toEqual(invoices);
  expect((await (await list(request({}), context)).json()).data).toEqual(invoices);
  expect(await db.invoice.count()).toBe(36);
  expect(await db.auditLog.count()).toBe(3);
});

it('requires renewed price confirmation after a price-list change before any writes', async () => {
  clock.today = '2026-11-05';
  const old = preview('laptop-004', '2026-11-06');
  clock.today = '2026-11-06';
  const rejected = await sign(request(old.input), undefined);
  expect(rejected.status).toBe(409);
  expect(await rejected.json()).toMatchObject({ error: { code: 'PRICE_CHANGED' } });
  expect(await db.contract.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
  const reviewed = preview('laptop-004', '2026-11-06');
  expect(reviewed.quote.monthlyNetCents).not.toBe(old.quote.monthlyNetCents);
  expect((await sign(request(reviewed.input), undefined)).status).toBe(201);
});

it('rejects a changed buyout even if rent and price-list version stay identical', async () => {
  const { input } = preview();
  const changed = {
    ...data,
    table: {
      ...data.table,
      end_of_term_buyout_percent_of_financed: {
        ...data.table.end_of_term_buyout_percent_of_financed,
        '36': 16,
      },
    },
  };
  await expect(signApplication(db, input, clock.today, changed)).rejects.toMatchObject({
    code: 'PRICE_CHANGED',
  });
  expect(await db.contract.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
  const confirmed = await signApplication(
    db,
    { ...input, expectedBuyoutNetCents: 62240 },
    clock.today,
    changed
  );
  expect(confirmed).toMatchObject({
    monthlyNetCents: input.expectedMonthlyNetCents,
    buyoutNetCents: 62240,
  });
});

it.each([{}, { ...answers, q_birth_date: '2010-01-01' }, { ...answers, q_country: 'other' }])(
  'cannot bypass eligibility with supplied answers',
  async (supplied) => {
    const { input } = preview();
    const response = await sign(request({ ...input, answers: supplied }), undefined);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_APPROVED' } });
    expect(await db.contract.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  }
);
