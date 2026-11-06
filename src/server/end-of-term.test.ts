import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  loadAssets,
  loadCoefficientTable,
  loadPriceLists,
  loadQuestions,
  loadVatRates,
} from '@/data/load';
import { priceContract } from '@/domain/contract-pricing';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { signApplication, type SigningData } from './contracts';
import {
  chooseEndTerm,
  completeEndTermBuyout,
  getPassOnPrice,
  readEndTermView,
} from './end-of-term';
import { finalizeDueReturns, recordReceipt } from './next-life-commands';
import { runLifecycleTick } from './lifecycle-worker';
import type { PrismaClient } from './prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let signing: SigningData;
const assetId = 'ebike-003';
const contractId = 'ending-lease';
const endOn = '2027-01-01';
const notice = '2026-12-10';
const renter = { contractId, userId: 'renter' };

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const [lists, table, vatRates, questions] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
    loadQuestions(),
  ]);
  signing = { lists, table, vatRates, questions: questions.questions };
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.returnIntake.deleteMany();
  await db.contractProvider.deleteMany();
  await db.contract.deleteMany();
  await db.auditLog.deleteMany();
  await db.asset.deleteMany();
  await db.demoUser.deleteMany();
  await seedAssets(db, await loadAssets());
  await db.asset.update({
    where: { id: assetId },
    data: { ownerId: 'provider', status: 'reserved' },
  });
  await db.demoUser.createMany({
    data: ['provider', 'renter', 'nominee', 'outsider'].map((id) => ({
      id,
      canonicalUsername: id,
      displayName: id,
    })),
  });
  const price = {
    listPriceCents: 389_000,
    downPaymentCents: 0,
    financedCents: 389_000,
    monthlyNetCents: 10_730,
    buyoutNetCents: 58_350,
    priceListVersion: 1,
    coefficientVersion: 1,
    coefficientId: 'ct-2026-1',
    band: 'B',
    factor: 0.027584,
  };
  await db.contract.create({
    data: {
      id: contractId,
      actor: 'renter',
      renterId: 'renter',
      providerId: 'provider',
      assetId,
      startOn: '2026-01-01',
      signedOn: '2026-01-01',
      endOn,
      termMonths: 12,
      ...price,
      lines: { create: { id: 'old-line', assetId, ...price } },
      lifecycle: { create: {} },
    },
  });
  await db.contractProvider.create({ data: { contractId, providerId: 'provider', assetId } });
});

it('settles the locked buyout at the payment date VAT and removes provider ownership', async () => {
  await chooseEndTerm(db, { ...renter, kind: 'end_buyout' }, notice);
  await expect(
    completeEndTermBuyout(db, contractId, 'provider', 73_229, endOn)
  ).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
  expect(await completeEndTermBuyout(db, contractId, 'provider', 73_521, endOn)).toMatchObject({
    netCents: 58_350,
    vatCents: 15_171,
  });
  expect(await db.asset.findUnique({ where: { id: assetId } })).toMatchObject({
    ownerId: 'renter',
    status: 'reserved',
    previous_lives: 1,
  });
  expect(await db.contractLifecycle.findUnique({ where: { contractId } })).toMatchObject({
    status: 'completed_buyout',
    actualEndOn: endOn,
  });
  expect(await db.auditLog.count({ where: { action: 'end_term.buyout_paid' } })).toBe(1);
});

it('accepts a free return in the existing intake and completes it only once at term end', async () => {
  await chooseEndTerm(db, { ...renter, kind: 'end_return' }, notice);
  const receipt = await recordReceipt(db, 'provider', contractId, '2026-12-31');
  expect(receipt.completed).toBe(false);
  expect(await runLifecycleTick(db, endOn)).toMatchObject({ completed: 1 });
  expect(await finalizeDueReturns(db, endOn)).toBe(0);
  expect(await db.returnIntake.findUnique({ where: { id: receipt.id } })).toMatchObject({
    completedOn: endOn,
  });
  expect(await db.contractLifecycle.findUnique({ where: { contractId } })).toMatchObject({
    status: 'completed_return',
  });
  expect(await db.assetLifeCompletion.findFirst({ where: { contractId } })).toMatchObject({
    kind: 'end_return',
  });
});

it('keeps an offered lease active until the nominated renter signs a new contract', async () => {
  await chooseEndTerm(db, { ...renter, kind: 'pass_on', nomineeId: 'nominee' }, notice);
  await expect(recordReceipt(db, 'provider', contractId, endOn)).rejects.toMatchObject({
    code: 'ENDING_ALREADY_CHOSEN',
  });
  expect(await runLifecycleTick(db, endOn)).toMatchObject({ completed: 0 });
  expect(await readEndTermView(db, contractId, 'nominee', endOn)).toEqual({
    role: 'nominee',
    assetId,
    endOn,
    completedOn: null,
  });
  await expect(
    getPassOnPrice(db, contractId, assetId, 'outsider', endOn, signing)
  ).rejects.toMatchObject({ code: 'PASS_ON_NOT_FOUND' });
  const override = await getPassOnPrice(db, contractId, assetId, 'nominee', endOn, signing);
  const input = { assetId, termMonths: 36, downPaymentCents: 0, startOn: endOn };
  const result = priceContract(signing.lists, signing.table, input, endOn, [], override);
  if (!result.ok) throw new Error('Expected a second-life quote');
  const next = await signApplication(
    db,
    {
      ...input,
      passOnContractId: contractId,
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
      expectedMonthlyNetCents: result.price.monthlyNetCents,
      expectedBuyoutNetCents: result.price.buyoutNetCents,
      expectedPriceListVersion: result.price.priceListVersion,
      expectedPriceSource: 'next_life',
      expectedListPriceCents: result.price.listPriceCents,
    },
    endOn,
    signing,
    'nominee'
  );
  expect(next).toMatchObject({
    renterId: 'nominee',
    providerId: 'provider',
    priceSource: 'next_life',
    listPriceCents: override.priceCents,
  });
  expect(await db.contractLifecycle.findUnique({ where: { contractId } })).toMatchObject({
    status: 'passed_on',
    actualEndOn: endOn,
  });
  expect(await db.endTermChoice.findUnique({ where: { contractId } })).toMatchObject({
    nextContractId: next.id,
    completedOn: endOn,
  });
  expect(await db.asset.findUnique({ where: { id: assetId } })).toMatchObject({
    status: 'reserved',
    previous_lives: 1,
  });
  expect(await db.returnIntake.count()).toBe(0);
  expect(await db.auditLog.findFirst({ where: { entity_id: next.id } })).toMatchObject({
    action: 'contract.signed',
    details_json: expect.stringContaining(contractId),
  });
});
