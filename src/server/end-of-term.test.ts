import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import * as dataLoad from '@/data/load';
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
  withdrawEndTerm,
  completePassOnInTx,
} from './end-of-term';
import { withAudit } from './audit';
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
afterEach(() => vi.restoreAllMocks());
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

it('scopes the ending view to both participants and handles legacy leases without lifecycle rows', async () => {
  await db.contractLifecycle.delete({ where: { contractId } });
  expect(await readEndTermView(db, contractId, 'renter', notice)).toMatchObject({
    role: 'renter',
    available: true,
    buyout: { netCents: 58_350 },
  });
  expect(await readEndTermView(db, contractId, 'provider', notice)).toMatchObject({
    role: 'provider',
  });
  await expect(readEndTermView(db, contractId, 'outsider', notice)).rejects.toMatchObject({
    code: 'NOT_PARTICIPANT',
  });
  await expect(readEndTermView(db, 'missing', 'renter', notice)).rejects.toMatchObject({
    code: 'CONTRACT_NOT_FOUND',
  });
  await db.contractLine.deleteMany({ where: { contractId } });
  await chooseEndTerm(db, { ...renter, kind: 'end_buyout' }, notice);
  await completeEndTermBuyout(db, contractId, 'provider', 73_521, endOn);
  expect(await db.assetLifeCompletion.count({ where: { contractId } })).toBe(1);
});

it('keeps free endings visible when tax data is unavailable', async () => {
  const vat = await loadVatRates();
  vi.spyOn(dataLoad, 'loadVatRates').mockResolvedValue({ ...vat, rates: [] });
  expect(await readEndTermView(db, contractId, 'renter', notice)).toMatchObject({
    buyout: null,
    options: { end_buyout: null, end_return: { grossCents: 0 } },
  });
  await expect(chooseEndTerm(db, { ...renter, kind: 'end_buyout' }, notice)).rejects.toMatchObject({
    code: 'END_TERM_NOT_AVAILABLE',
  });
});

it('rejects a non-renter, an early request, and a lease without a provider without auditing a choice', async () => {
  await expect(
    chooseEndTerm(db, { ...renter, userId: 'provider', kind: 'end_return' }, notice)
  ).rejects.toMatchObject({ code: 'NOT_RENTER' });
  await expect(
    chooseEndTerm(db, { ...renter, kind: 'end_return' }, '2026-11-01')
  ).rejects.toMatchObject({ code: 'END_TERM_NOT_AVAILABLE' });
  await db.contract.update({ where: { id: contractId }, data: { providerId: null } });
  await expect(chooseEndTerm(db, { ...renter, kind: 'end_return' }, notice)).rejects.toMatchObject({
    code: 'END_TERM_NOT_AVAILABLE',
  });
  expect(await db.endTermChoice.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
});

it.each([undefined, 'renter', 'provider', 'missing'])(
  'rejects invalid pass-on nominee %s',
  async (nomineeId) => {
    await expect(
      chooseEndTerm(db, { ...renter, kind: 'pass_on', nomineeId }, notice)
    ).rejects.toMatchObject({ code: 'INVALID_NOMINEE' });
    expect(await db.endTermChoice.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  }
);

it('does not offer an entire bundle to a single pass-on nominee', async () => {
  const line = await db.contractLine.findFirstOrThrow({ where: { contractId } });
  await db.asset.update({
    where: { id: 'ebike-004' },
    data: { ownerId: 'provider', status: 'reserved' },
  });
  await db.contractLine.create({ data: { ...line, id: 'second-line', assetId: 'ebike-004' } });
  await expect(
    chooseEndTerm(db, { ...renter, kind: 'pass_on', nomineeId: 'nominee' }, notice)
  ).rejects.toMatchObject({ code: 'INVALID_NOMINEE' });
});

it('rejects a second ending without changing the first', async () => {
  const first = await chooseEndTerm(db, { ...renter, kind: 'end_return' }, notice);
  await expect(chooseEndTerm(db, { ...renter, kind: 'end_buyout' }, notice)).rejects.toMatchObject({
    code: 'ENDING_ALREADY_CHOSEN',
  });
  expect(await db.endTermChoice.findUnique({ where: { contractId } })).toEqual(first);
  expect(await db.auditLog.count()).toBe(1);
});

it('withdraws only a pending choice owned by the renter', async () => {
  await chooseEndTerm(db, { ...renter, kind: 'end_return' }, notice);
  await expect(withdrawEndTerm(db, contractId, 'outsider')).rejects.toMatchObject({
    code: 'NOT_RENTER',
  });
  expect(await withdrawEndTerm(db, contractId, 'renter')).toEqual({ withdrawn: true });
  await expect(withdrawEndTerm(db, contractId, 'renter')).rejects.toMatchObject({
    code: 'END_TERM_CHANGED',
  });
  expect(await db.endTermChoice.count()).toBe(0);
  expect(await db.auditLog.count({ where: { action: 'end_term.withdrawn' } })).toBe(1);
});

it('cannot withdraw a received return or choose another ending after receipt', async () => {
  await chooseEndTerm(db, { ...renter, kind: 'end_return' }, notice);
  await recordReceipt(db, 'provider', contractId, notice);
  await expect(withdrawEndTerm(db, contractId, 'renter')).rejects.toMatchObject({
    code: 'END_TERM_CHANGED',
  });
  await db.endTermChoice.delete({ where: { contractId } });
  await expect(chooseEndTerm(db, { ...renter, kind: 'end_buyout' }, notice)).rejects.toMatchObject({
    code: 'ENDING_ALREADY_CHOSEN',
  });
});

it('checks payment authority, the chosen ending, and the completion date before transferring ownership', async () => {
  await expect(
    completeEndTermBuyout(db, contractId, 'renter', 73_521, endOn)
  ).rejects.toMatchObject({ code: 'NOT_PROVIDER' });
  await expect(
    completeEndTermBuyout(db, contractId, 'provider', 73_521, endOn)
  ).rejects.toMatchObject({ code: 'END_TERM_CHANGED' });
  await chooseEndTerm(db, { ...renter, kind: 'end_return' }, notice);
  await expect(
    completeEndTermBuyout(db, contractId, 'provider', 73_521, endOn)
  ).rejects.toMatchObject({ code: 'END_TERM_CHANGED' });
  await withdrawEndTerm(db, contractId, 'renter');
  await chooseEndTerm(db, { ...renter, kind: 'end_buyout' }, notice);
  await expect(
    completeEndTermBuyout(db, contractId, 'provider', 73_521, notice)
  ).rejects.toMatchObject({ code: 'END_TERM_CHANGED' });
  await completeEndTermBuyout(db, contractId, 'provider', 73_521, endOn);
  await expect(
    completeEndTermBuyout(db, contractId, 'provider', 73_521, endOn)
  ).rejects.toMatchObject({ code: 'END_TERM_CHANGED' });
  expect(await db.assetLifeCompletion.count()).toBe(1);
});

it('refuses a pass-on before its date, after completion, or when ownership changes', async () => {
  await chooseEndTerm(db, { ...renter, kind: 'pass_on', nomineeId: 'nominee' }, notice);
  await expect(
    getPassOnPrice(db, contractId, assetId, 'nominee', notice, signing)
  ).rejects.toMatchObject({ code: 'PASS_ON_UNAVAILABLE' });
  await db.asset.update({ where: { id: assetId }, data: { ownerId: 'outsider' } });
  await expect(
    getPassOnPrice(db, contractId, assetId, 'nominee', endOn, signing)
  ).rejects.toMatchObject({ code: 'PASS_ON_UNAVAILABLE' });
  await db.asset.update({ where: { id: assetId }, data: { ownerId: 'provider' } });
  await db.endTermChoice.update({ where: { contractId }, data: { completedOn: endOn } });
  await expect(
    getPassOnPrice(db, contractId, assetId, 'nominee', endOn, signing)
  ).rejects.toMatchObject({ code: 'PASS_ON_UNAVAILABLE' });
});

it('reports an unfinanceable pass-on price without ending the existing lease', async () => {
  await chooseEndTerm(db, { ...renter, kind: 'pass_on', nomineeId: 'nominee' }, notice);
  await db.contract.update({ where: { id: contractId }, data: { listPriceCents: 1 } });
  await expect(
    getPassOnPrice(db, contractId, assetId, 'nominee', endOn, signing)
  ).rejects.toMatchObject({ code: 'INVALID_NEXT_LIFE_PRICE' });
  expect(await db.contractLifecycle.findUnique({ where: { contractId } })).toMatchObject({
    status: 'active',
  });
});

it('rolls back all pass-on writes if another operation has already completed the lease', async () => {
  await chooseEndTerm(db, { ...renter, kind: 'pass_on', nomineeId: 'nominee' }, notice);
  await db.contractLifecycle.update({
    where: { contractId },
    data: { status: 'completed_return' },
  });
  await expect(
    withAudit(
      db,
      { actor: 'nominee', action: 'contract.signed', entityType: 'contract', entityId: contractId },
      (tx) =>
        completePassOnInTx(tx, {
          contractId,
          nextContractId: 'next',
          assetId,
          endOn,
          today: endOn,
          priceCents: 100_000,
        })
    )
  ).rejects.toMatchObject({ code: 'CONTRACT_COMPLETED' });
  expect(await db.assetLifeCompletion.count()).toBe(0);
  expect(await db.endTermChoice.findUnique({ where: { contractId } })).toMatchObject({
    completedOn: null,
  });
});
