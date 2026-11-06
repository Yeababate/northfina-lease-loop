import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  loadAssets,
  loadCoefficientTable,
  loadPriceLists,
  loadQuestions,
  loadVatRates,
} from '@/data/load';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { signApplication, signContract, type SigningData } from './contracts';
import { seedDemoParticipants } from './demo-participants';
import type { PrismaClient } from './prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let data: SigningData;
const today = '2026-11-05';
const input = {
  assetId: 'ebike-003',
  actor: 'cust-aino',
  termMonths: 36,
  downPaymentCents: 0,
  expectedMonthlyNetCents: 10730,
  expectedBuyoutNetCents: 58350,
  expectedPriceListVersion: 1,
};
const application = {
  ...input,
  startOn: today,
  answers: {
    q_customer_type: 'consumer',
    q_full_name: 'Aino Virtanen',
    q_birth_date: '1992-03-14',
    q_email: 'aino@example.com',
    q_country: 'FI',
    q_employment: 'employed',
    q_monthly_income: 320000,
    q_usage_purpose: 'commuting',
  },
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
  await db.contract.deleteMany();
  await db.asset.deleteMany();
  await db.demoUser.deleteMany();
  await seedAssets(db, await loadAssets());
  await seedDemoParticipants(db);
  await db.auditLog.deleteMany();
});

it('requires a selected nominee for both signing entry points', async () => {
  await expect(
    signContract(db, { ...input, passOnContractId: 'old' }, today, data.lists, data.table)
  ).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
  await expect(
    signApplication(db, { ...application, passOnContractId: 'old' }, today, data)
  ).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
  expect(await db.contract.count()).toBe(0);
});

it.each(['unknown-user', 'unowned', 'own-asset', 'unknown-provider', 'conflicting-provider'])(
  'refuses %s before signing or auditing',
  async (scenario) => {
    let principal = 'cust-aino';
    if (scenario === 'unknown-user') principal = 'missing';
    if (scenario === 'unowned')
      await db.asset.update({ where: { id: input.assetId }, data: { ownerId: null } });
    if (scenario === 'own-asset') principal = 'provider-kettu';
    if (scenario === 'unknown-provider')
      await db.demoUser.delete({ where: { id: 'provider-kettu' } });
    if (scenario === 'conflicting-provider')
      await db.assetOwnership.upsert({
        where: { assetId: input.assetId },
        create: { assetId: input.assetId, providerId: 'provider-pelto', source: 'test' },
        update: { providerId: 'provider-pelto' },
      });
    const code =
      scenario === 'unknown-user'
        ? 'LOGIN_REQUIRED'
        : scenario === 'own-asset'
          ? 'OWN_ASSET'
          : 'PROVIDER_REQUIRED';
    await expect(signApplication(db, application, today, data, principal)).rejects.toMatchObject({
      code,
    });
    expect(await db.contract.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  }
);

it.each(['disappeared', 'unfinanceable', 'repriced'])(
  'rechecks a %s item inside the transaction before committing',
  async (scenario) => {
    let reads = 0;
    const racing = db.$extends({
      query: {
        asset: {
          async findUnique({ args, query }) {
            const row = await query(args);
            if (++reads !== 2 || !row) return row;
            if (scenario === 'disappeared') return null;
            return {
              ...row,
              nextLifePriceCents: scenario === 'unfinanceable' ? 1 : 500_000,
              nextLifePricedOn: today,
            };
          },
        },
      },
    }) as unknown as PrismaClient;
    const code =
      scenario === 'disappeared'
        ? 'ASSET_NOT_FOUND'
        : scenario === 'unfinanceable'
          ? 'INVALID_PRICE'
          : 'PRICE_CHANGED';
    await expect(signContract(racing, input, today, data.lists, data.table)).rejects.toMatchObject({
      code,
    });
    expect(await db.contract.count()).toBe(0);
    expect(await db.contractDocument.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
    expect(await db.asset.findUnique({ where: { id: input.assetId } })).toMatchObject({
      status: 'available',
    });
  }
);
