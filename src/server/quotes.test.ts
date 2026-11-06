import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as signApi } from '@/app/api/contracts/route';
import { POST as quoteApi } from '@/app/api/quotes/route';
import { loadAssets, loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
import { priceContract } from '@/domain/contract-pricing';
import { vatCents, vatRateOn } from '@/domain/vat';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { demoNameCookieHeader } from './demo-cookie';
import { seedDemoParticipants } from './demo-participants';
import type { PrismaClient } from './prisma-client';
import { seedDealerSide } from './providers';
import { rulesForAsset, saveDiscountRule } from './discount-rules';
import { assetPriceOverride } from './assets';

const clock = vi.hoisted(() => ({ today: '2026-11-05' }));
vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
vi.mock('@/server/today', () => ({ todayIso: () => clock.today }));

let db: PrismaClient;
let cleanup: () => Promise<void>;
let lists: Awaited<ReturnType<typeof loadPriceLists>>;
let table: Awaited<ReturnType<typeof loadCoefficientTable>>;
let vatRates: Awaited<ReturnType<typeof loadVatRates>>;
const assetId = 'laptop-004';
const lease = { assetId, termMonths: 36, downPaymentCents: 0, startOn: '2026-11-06' };
const aino = {
  q_customer_type: 'consumer',
  q_full_name: 'Aino Virtanen',
  q_birth_date: '1992-03-14',
  q_email: 'aino@example.com',
  q_country: 'FI',
  q_employment: 'employed',
  q_monthly_income: 320000,
};

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  [lists, table, vatRates] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
  ]);
});

afterAll(async () => cleanup());

beforeEach(async () => {
  clock.today = '2026-11-05';
  await db.invoice.deleteMany();
  await db.contractProvider.deleteMany();
  await db.contract.deleteMany();
  await db.quote.deleteMany();
  await db.discountRule.deleteMany();
  await db.assetOwnership.deleteMany();
  await db.auditLog.deleteMany();
  await db.asset.deleteMany();
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await seedDealerSide(db, assets);
  await seedDemoParticipants(db);
  await db.auditLog.deleteMany();
});

function request(url: string, name: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: demoNameCookieHeader(name) },
    body: JSON.stringify(body),
  });
}

async function pricedOn(date: string) {
  const asset = await db.asset.findUniqueOrThrow({ where: { id: assetId } });
  const price = priceContract(
    lists,
    table,
    lease,
    date,
    await rulesForAsset(db, assetId),
    assetPriceOverride(asset)
  );
  if (!price.ok) throw new Error(`Cannot price laptop fixture: ${price.reason}`);
  return price.price;
}

async function quoteRequestBody(requestKey: string) {
  const price = await pricedOn(clock.today);
  const vat = vatRateOn(vatRates.rates, lease.startOn);
  if (!vat.ok) throw new Error('No VAT fixture');
  return {
    requestKey,
    ...lease,
    quotedOn: clock.today,
    expected: {
      monthlyNetCents: price.monthlyNetCents,
      originalMonthlyNetCents: price.originalMonthlyNetCents,
      monthlyDiscountCents: price.monthlyDiscountCents,
      discountBps: price.discountBps,
      buyoutNetCents: price.buyoutNetCents,
      monthlyGrossCents:
        price.monthlyNetCents + vatCents(price.monthlyNetCents, vat.rate.rate_percent),
      priceListVersion: price.priceListVersion,
      priceSource: price.priceSource,
      listPriceCents: price.listPriceCents,
      discountRuleId: price.discountRuleId,
      discountRuleRevision: price.discountRuleRevision,
      coefficientVersion: price.coefficientVersion,
      coefficientId: price.coefficientId,
      band: price.band,
      factor: price.factor,
    },
  };
}

function signingBody(price: Awaited<ReturnType<typeof pricedOn>>, quoteId?: string) {
  return {
    ...lease,
    ...(quoteId ? { quoteId } : {}),
    answers: aino,
    expectedMonthlyNetCents: price.monthlyNetCents,
    expectedBuyoutNetCents: price.buyoutNetCents,
    expectedPriceListVersion: price.priceListVersion,
    expectedPriceSource: price.priceSource,
    expectedListPriceCents: price.listPriceCents,
    expectedDiscountRuleId: price.discountRuleId,
    expectedDiscountRuleRevision: price.discountRuleRevision,
    locale: 'en',
  };
}

describe('persisted quote flow', () => {
  it('persists card 2, retries idempotently, requires fresh signing consent, then locks v2', async () => {
    const requestKey = '2ee76e9a-276f-4a51-9784-52f1f11b4a07';
    const body = await quoteRequestBody(requestKey);
    const url = 'http://localhost/api/quotes';
    const first = await quoteApi(request(url, 'Aino', body), undefined);
    expect(first.status).toBe(201);
    const quote = (await first.json()).data;
    expect(quote).toMatchObject({
      renterId: 'cust-aino',
      assetId,
      termMonths: 36,
      downPaymentCents: 0,
      startOn: lease.startOn,
      quotedOn: '2026-11-05',
      priceListVersion: 1,
    });
    const retry = await quoteApi(request(url, 'Aino', body), undefined);
    expect(retry.status).toBe(200);
    expect((await retry.json()).data.id).toBe(quote.id);
    expect(await db.quote.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'quote.created' } })).toBe(1);

    const versionOne = await pricedOn('2026-11-05');
    clock.today = '2026-11-06';
    const versionTwo = await pricedOn(clock.today);
    expect(versionTwo.priceListVersion).toBe(2);
    expect(versionTwo.monthlyNetCents).toBeLessThan(versionOne.monthlyNetCents);
    const signUrl = 'http://localhost/api/contracts';
    const stale = await signApi(
      request(signUrl, 'Aino', signingBody(versionOne, quote.id)),
      undefined
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe('PRICE_CHANGED');
    expect(await db.contract.count()).toBe(0);

    const signed = await signApi(
      request(signUrl, 'Aino', signingBody(versionTwo, quote.id)),
      undefined
    );
    expect(signed.status).toBe(201);
    const contract = (await signed.json()).data;
    expect(contract).toMatchObject({
      quoteId: quote.id,
      quotedPriceListVersion: 1,
      lockedPriceListVersion: 2,
      priceListVersion: 2,
      monthlyNetCents: versionTwo.monthlyNetCents,
      buyoutNetCents: versionTwo.buyoutNetCents,
    });
    const retrySign = await signApi(
      request(signUrl, 'Aino', signingBody(versionTwo, quote.id)),
      undefined
    );
    expect(retrySign.status).toBe(201);
    expect((await retrySign.json()).data.id).toBe(contract.id);
    expect(await db.contract.count()).toBe(1);
  });

  it('rejects foreign, unknown and settings-mismatched quote references', async () => {
    const body = await quoteRequestBody('47fa45e0-b64b-412f-86eb-75d6db1670b0');
    const created = await quoteApi(request('http://localhost/api/quotes', 'Aino', body), undefined);
    const quote = (await created.json()).data;
    const price = await pricedOn(clock.today);
    const signUrl = 'http://localhost/api/contracts';

    const foreign = await signApi(
      request(signUrl, 'Kettu', signingBody(price, quote.id)),
      undefined
    );
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).error.code).toBe('QUOTE_NOT_FOUND');
    const missing = await signApi(
      request(signUrl, 'Aino', signingBody(price, '53e4554b-bf15-4fa7-8d31-5b1a7b5a1c6b')),
      undefined
    );
    expect(missing.status).toBe(404);
    const changedTerms = await signApi(
      request(signUrl, 'Aino', {
        ...signingBody(price, quote.id),
        termMonths: 24,
      }),
      undefined
    );
    expect(changedTerms.status).toBe(409);
    expect((await changedTerms.json()).error.code).toBe('QUOTE_MISMATCH');
    expect(await db.contract.count()).toBe(0);
  });

  it('persists the displayed dealer discount snapshot unchanged after a rule edit', async () => {
    const owner = await db.assetOwnership.findUniqueOrThrow({ where: { assetId } });
    const rule = await saveDiscountRule(db, owner.providerId, {
      name: 'Long lease quote',
      minTermMonths: 36,
      maxTermMonths: 48,
      discountBps: 1000,
      enabled: true,
    });
    const body = await quoteRequestBody('0d10b682-5bfa-4b3f-8833-8df8ca28b7ee');
    const response = await quoteApi(
      request('http://localhost/api/quotes', 'Aino', body),
      undefined
    );
    const quoted = (await response.json()).data;
    expect(quoted).toMatchObject({
      originalMonthlyNetCents: expect.any(Number),
      monthlyDiscountCents: expect.any(Number),
      monthlyNetCents: quoted.originalMonthlyNetCents - quoted.monthlyDiscountCents,
      discountBps: 1000,
      discountRuleId: rule.id,
      discountRuleRevision: 1,
    });
    await saveDiscountRule(
      db,
      owner.providerId,
      {
        name: 'Long lease quote',
        minTermMonths: 36,
        maxTermMonths: 48,
        discountBps: 500,
        enabled: true,
      },
      { id: rule.id, revision: rule.revision }
    );
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoted.id } })).toMatchObject({
      monthlyNetCents: quoted.monthlyNetCents,
      monthlyDiscountCents: quoted.monthlyDiscountCents,
      discountBps: 1000,
      discountRuleRevision: 1,
    });
  });

  it('keeps legacy application links working without a persisted quote', async () => {
    const price = await pricedOn(clock.today);
    const response = await signApi(
      request('http://localhost/api/contracts', 'Aino', signingBody(price)),
      undefined
    );
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({
      quoteId: null,
      quotedPriceListVersion: price.priceListVersion,
      lockedPriceListVersion: price.priceListVersion,
      monthlyNetCents: price.monthlyNetCents,
    });
  });
});
