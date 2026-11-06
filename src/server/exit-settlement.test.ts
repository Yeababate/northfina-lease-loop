// The early-exit price stays indicative until completion, then its net is frozen (#43).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { loadAssets } from '@/data/load';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { acknowledgeEarlyExit, finalizeDueReturns } from './exit-completion';
import { readExitView, requestEarlyExit } from './exit-requests';
import type { PrismaClient } from './prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
const on = '2026-07-31';
const boundary = '2026-08-31';

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.returnIntake.deleteMany();
  await db.contract.deleteMany();
  await db.demoUser.deleteMany();
  await db.asset.deleteMany();
  await db.auditLog.deleteMany();
  await seedAssets(db, await loadAssets());
  await db.demoUser.createMany({
    data: ['renter', 'provider'].map((id) => ({ id, canonicalUsername: id, displayName: id })),
  });
  await db.asset.update({
    where: { id: 'ebike-003' },
    data: { status: 'reserved', ownerId: 'provider' },
  });
  const price = {
    listPriceCents: 389000,
    downPaymentCents: 0,
    financedCents: 389000,
    monthlyNetCents: 10730,
    buyoutNetCents: 58350,
    priceListVersion: 1,
    coefficientVersion: 1,
    coefficientId: 'ct-2026-1',
    band: 'B',
    factor: 0.027584,
  };
  await db.contract.create({
    data: {
      id: 'contract',
      actor: 'renter',
      renterId: 'renter',
      providerId: 'provider',
      assetId: 'ebike-003',
      signedOn: '2026-01-01',
      startOn: '2026-01-31',
      endOn: '2029-01-31',
      termMonths: 36,
      ...price,
      lines: { create: { id: 'line-1', assetId: 'ebike-003', ...price } },
      lifecycle: { create: {} },
    },
  });
});

async function requestReturn() {
  const view = await readExitView(db, 'contract', 'renter', on);
  if (!view.returnQuote.ok) throw new Error('Expected quote');
  return requestEarlyExit(
    db,
    {
      requestId: randomUUID(),
      contractId: 'contract',
      userId: 'renter',
      kind: 'return',
      expectedQuote: view.returnQuote.quote,
    },
    on
  );
}

async function inspect(id: string, condition: string, usageValue: number) {
  await db.returnIntake.upsert({
    where: { id: 'intake' },
    create: {
      id: 'intake',
      assetId: 'ebike-003',
      contractId: 'contract',
      providerId: 'provider',
      source: 'receipt',
    },
    update: {},
  });
  await db.returnInspection.create({
    data: {
      id,
      intakeId: 'intake',
      inspectedOn: on,
      actor: 'provider',
      conditionBefore: 'new',
      condition,
      usageBefore: 0,
      usageValue,
    },
  });
}

const receive = (exitId: string, revision: number, today: string) =>
  acknowledgeEarlyExit(
    db,
    {
      exitId,
      userId: 'provider',
      expectedRevision: revision,
      balancesReviewed: true,
      assetIds: ['ebike-003'],
    },
    today
  );

it('re-prices a request made before inspection once the item is inspected', async () => {
  const exit = await requestReturn();
  expect(JSON.parse(exit.quoteJson)).toMatchObject({ amountNetCents: 68005 });
  await inspect('inspection-1', 'fair', 1500);
  const { request } = await readExitView(db, 'contract', 'renter', on);
  // Fair, 1 500 km: 389 000 × 80 % × 0.65 × 0.98 = 198 234 credit → 332 525 − 198 234.
  expect(request).toMatchObject({
    status: 'pending',
    quote: { amountNetCents: 68005 },
    currentQuote: {
      amountNetCents: 134291,
      breakdown: { valuedItems: [{ basis: 'inspected', condition: 'fair' }] },
    },
    priceChange: { reason: 'inspection', previousNetCents: 68005 },
    charge: null,
  });
  expect(
    JSON.parse((await db.exitRequest.findUniqueOrThrow({ where: { id: exit.id } })).quoteJson)
  ).toMatchObject({ amountNetCents: 68005 });
});

it('freezes the net at completion, audits it, and ignores later data', async () => {
  const exit = await requestReturn();
  await inspect('inspection-1', 'fair', 1500);
  // Received early: still open, so still indicative and not frozen.
  const received = await receive(exit.id, 0, on);
  expect(received.status).toBe('received');
  expect(JSON.parse(received.quoteJson).frozenOn).toBeUndefined();
  // The exit date arrives: the lifecycle worker completes it, re-pricing once more and freezing.
  expect(await finalizeDueReturns(db, boundary)).toEqual({ completed: 1, failedIds: [] });
  const done = await db.exitRequest.findUniqueOrThrow({ where: { id: exit.id } });
  expect(done.status).toBe('completed');
  const frozen = JSON.parse(done.quoteJson);
  expect(frozen).toMatchObject({ amountNetCents: 134291, frozenOn: boundary, contractRevision: 0 });
  const audit = await db.auditLog.findMany({ where: { action: 'exit.return_finalized' } });
  expect(audit).toHaveLength(1);
  expect(JSON.parse(audit[0]!.details_json!)).toMatchObject({
    indicativeQuote: { amountNetCents: 68005 },
    frozenQuote: { amountNetCents: 134291, frozenOn: boundary },
  });
  // A later, better inspection no longer changes the frozen price.
  await inspect('inspection-2', 'like_new', 0);
  const view = await readExitView(db, 'contract', 'renter', boundary);
  expect(view.request).toMatchObject({
    status: 'completed',
    quote: { amountNetCents: 134291, frozenOn: boundary },
    currentQuote: null,
    priceChange: null,
  });
});

it('lets a VAT change after completion change only the gross', async () => {
  const view = await readExitView(db, 'contract', 'renter', on);
  if (!view.buyoutQuote.ok) throw new Error('Expected quote');
  const exit = await requestEarlyExit(
    db,
    {
      requestId: randomUUID(),
      contractId: 'contract',
      userId: 'renter',
      kind: 'buyout',
      expectedQuote: view.buyoutQuote.quote,
    },
    on
  );
  await acknowledgeEarlyExit(
    db,
    { exitId: exit.id, userId: 'provider', expectedRevision: 0, balancesReviewed: true },
    on
  );
  const before = (await readExitView(db, 'contract', 'renter', '2026-12-31')).request;
  const after = (await readExitView(db, 'contract', 'renter', '2027-01-01')).request;
  expect(before?.quote).toEqual(after?.quote);
  expect(before?.charge).toEqual({
    netCents: 332525,
    vatRatePercent: 25.5,
    vatCents: 84794, // 84 793.875 → half up
    grossCents: 417319,
    invoiceOn: '2026-12-31',
  });
  expect(after?.charge).toEqual({
    netCents: 332525,
    vatRatePercent: 26,
    vatCents: 86457,
    grossCents: 418982,
    invoiceOn: '2027-01-01',
  });
});
