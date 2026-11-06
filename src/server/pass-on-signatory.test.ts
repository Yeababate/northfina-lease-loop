// Issue #78: a pass-on to a company whose applicant may not sign (Card 6). The old lease, the
// handover and the item's life count change only when the named signatory signs.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  loadAssets,
  loadCoefficientTable,
  loadPriceLists,
  loadQuestions,
  loadVatRates,
} from '@/data/load';
import { priceContract } from '@/domain/contract-pricing';
import { AWAITING_SIGNATURE } from '@/domain/signatory';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { signApplication, type SigningData } from './contracts';
import { chooseEndTerm, getPassOnPrice, withdrawEndTerm } from './end-of-term';
import type { PrismaClient } from './prisma-client';
import { signAsSignatory, signatoryOffer } from './signatory';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let signing: SigningData;
const assetId = 'ebike-003';
const contractId = 'ending-lease';
const endOn = '2027-01-01';
const notice = '2026-12-10';
const SIGNATORY = 'signatory@norvi.example.com';
const signer = { id: 'signatory', canonicalUsername: SIGNATORY };

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
    data: [
      ...['provider', 'renter', 'nominee'].map((id) => ({
        id,
        canonicalUsername: id,
        displayName: id,
      })),
      { id: signer.id, canonicalUsername: SIGNATORY, displayName: SIGNATORY },
    ],
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
  await chooseEndTerm(
    db,
    { contractId, userId: 'renter', kind: 'pass_on', nomineeId: 'nominee' },
    notice
  );
});

async function companyAcceptsPassOn() {
  const override = await getPassOnPrice(db, contractId, assetId, 'nominee', endOn, signing);
  const input = { assetId, termMonths: 36, downPaymentCents: 0, startOn: endOn };
  const result = priceContract(signing.lists, signing.table, input, endOn, [], override);
  if (!result.ok) throw new Error('Expected a second-life quote');
  return signApplication(
    db,
    {
      ...input,
      passOnContractId: contractId,
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
}

async function expectHandoverPending(nextId: string) {
  expect(await db.contractLifecycle.findUnique({ where: { contractId: nextId } })).toMatchObject({
    status: AWAITING_SIGNATURE,
  });
  expect(await db.contractLifecycle.findUnique({ where: { contractId } })).toMatchObject({
    status: 'active',
    actualEndOn: null,
  });
  expect(await db.endTermChoice.findUnique({ where: { contractId } })).toMatchObject({
    completedOn: null,
  });
  expect(await db.asset.findUnique({ where: { id: assetId } })).toMatchObject({
    status: 'reserved',
    previous_lives: 0,
  });
  expect(await db.assetLifeCompletion.count()).toBe(0);
}

it('keeps the old lease and the life count unchanged until the named signatory signs', async () => {
  const next = await companyAcceptsPassOn();
  await expectHandoverPending(next.id);
  expect(await db.endTermChoice.findUnique({ where: { contractId } })).toMatchObject({
    nextContractId: next.id,
  });
  // A second application for the same pass-on cannot create a duplicate pending lease.
  await expect(companyAcceptsPassOn()).rejects.toMatchObject({ code: 'PASS_ON_UNAVAILABLE' });

  const offer = await signatoryOffer(db, signer, next.id, endOn, signing);
  if (!offer.ok) throw new Error('Expected a current offer');
  expect(offer.snapshot).toMatchObject({
    priceSource: 'next_life',
    listPriceCents: next.listPriceCents,
  });
  const signed = await signAsSignatory(db, signer, next.id, endOn, signing, offer.snapshot);
  expect(signed.lifecycle).toEqual({ status: 'active' });

  expect(await db.contractLifecycle.findUnique({ where: { contractId } })).toMatchObject({
    status: 'passed_on',
    actualEndOn: endOn,
  });
  expect(await db.endTermChoice.findUnique({ where: { contractId } })).toMatchObject({
    completedOn: endOn,
    nextContractId: next.id,
  });
  expect(await db.asset.findUnique({ where: { id: assetId } })).toMatchObject({
    status: 'reserved',
    previous_lives: 1,
    nextLifePriceCents: next.listPriceCents,
  });
  expect(await db.assetLifeCompletion.count({ where: { contractId, kind: 'pass_on' } })).toBe(1);
  expect(await db.auditLog.count({ where: { action: 'contract.signatory_signed' } })).toBe(1);

  // A retry after success changes nothing: the life count moves exactly once.
  await expect(
    signAsSignatory(db, signer, next.id, endOn, signing, offer.snapshot)
  ).rejects.toMatchObject({ code: 'NOT_WAITING_FOR_SIGNATURE' });
  expect(await db.asset.findUnique({ where: { id: assetId } })).toMatchObject({
    previous_lives: 1,
  });
});

it('rolls back the signature when the old lease can no longer be handed over', async () => {
  const next = await companyAcceptsPassOn();
  const offer = await signatoryOffer(db, signer, next.id, endOn, signing);
  if (!offer.ok) throw new Error('Expected a current offer');
  // A concurrent ending wins first: the handover must not complete or activate the new lease.
  await db.contractLifecycle.update({
    where: { contractId },
    data: { status: 'completed_return' },
  });
  await expect(
    signAsSignatory(db, signer, next.id, endOn, signing, offer.snapshot)
  ).rejects.toMatchObject({ code: 'PASS_ON_UNAVAILABLE' });
  expect(await db.contractLifecycle.findUnique({ where: { contractId: next.id } })).toMatchObject({
    status: AWAITING_SIGNATURE,
  });
  expect(await db.contract.findUnique({ where: { id: next.id } })).toMatchObject({
    signatorySignedOn: null,
  });
  expect(await db.asset.findUnique({ where: { id: assetId } })).toMatchObject({
    previous_lives: 0,
  });
  expect(await db.auditLog.count({ where: { action: 'contract.signatory_signed' } })).toBe(0);
});

it('cancels the pending company lease when the renter withdraws the pass-on', async () => {
  const next = await companyAcceptsPassOn();
  await withdrawEndTerm(db, contractId, 'renter');
  expect(await db.contractLifecycle.findUnique({ where: { contractId: next.id } })).toMatchObject({
    status: 'cancelled',
  });
  expect(await db.contractLifecycle.findUnique({ where: { contractId } })).toMatchObject({
    status: 'active',
  });
  expect(await db.endTermChoice.count()).toBe(0);
  await expect(signatoryOffer(db, signer, next.id, endOn, signing)).rejects.toMatchObject({
    code: 'NOT_WAITING_FOR_SIGNATURE',
  });
  expect(await db.asset.findUnique({ where: { id: assetId } })).toMatchObject({
    status: 'reserved',
    previous_lives: 0,
  });
  expect(await db.assetLifeCompletion.count()).toBe(0);
});
