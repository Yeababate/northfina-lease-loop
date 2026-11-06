import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/assets/[id]/passport/route';
import { loadAssets, loadCoefficientTable, loadPriceLists } from '@/data/load';
import { priceContract } from '@/domain/contract-pricing';
import { createTestDb } from '../../tests/helpers/test-db';
import { assetPriceOverride, seedAssets } from './assets';
import { signContract } from './contracts';
import { recordInspection, recordReceipt, recordWork, relist } from './next-life-commands';
import { loadPassport } from './passport';
import type { PrismaClient } from './prisma-client';
import { seedDealerSide } from './providers';

let db: PrismaClient;
let cleanup: () => Promise<void>;
const provider = 'provider-kettu';
vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await seedDealerSide(db, assets);
});
afterAll(async () => {
  await cleanup();
});

async function sign(assetId: string, today: string) {
  const [lists, table, asset] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    db.asset.findUniqueOrThrow({ where: { id: assetId } }),
  ]);
  const input = { assetId, termMonths: 12, downPaymentCents: 0 };
  const quote = priceContract(lists, table, input, today, [], assetPriceOverride(asset));
  if (!quote.ok) throw new Error('Expected a priceable fixture');
  return signContract(
    db,
    {
      ...input,
      actor: 'Private renter name',
      expectedMonthlyNetCents: quote.price.monthlyNetCents,
      expectedBuyoutNetCents: quote.price.buyoutNetCents,
      expectedPriceListVersion: quote.price.priceListVersion,
      expectedPriceSource: quote.price.priceSource,
      expectedListPriceCents: quote.price.listPriceCents,
    },
    today,
    lists,
    table
  );
}

it('shows the seed e-bike’s third life through the public API', async () => {
  const assetId = 'ebike-008';
  const date = '2026-11-05';
  const intakeId = `seed-${assetId}`;
  expect(await loadPassport(db, assetId)).toMatchObject({ earlierLives: 2, lives: [] });
  await recordInspection(
    db,
    provider,
    intakeId,
    { expectedRevision: 0, condition: 'good', usageValue: 9800, hoursSinceService: null },
    date
  );
  await recordWork(
    db,
    provider,
    intakeId,
    { expectedRevision: 1, actionId: 'safety_inspection' },
    date
  );
  await relist(db, provider, intakeId, { expectedRevision: 2 }, date);
  const signed = await sign(assetId, date);
  const response = await GET(new Request('http://localhost/api/assets/ebike-008/passport'), {
    params: Promise.resolve({ id: assetId }),
  });
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data).toMatchObject({
    earlierLives: 2,
    totals: { lives: 3, estimatedLives: 1, refurbishmentCents: 4500 },
    lives: [{ number: 3, priceSource: 'next_life', estimatedCo2SavingGrams: expect.any(Number) }],
  });
  expect(JSON.stringify(data)).not.toContain('Private renter name');
  expect(JSON.stringify(data)).not.toContain(signed.id);
});

it('joins a recorded return, itemised work, and a later signing in chronological lives', async () => {
  const first = await sign('ebike-003', '2026-11-05');
  const date = first.endOn;
  const intake = await recordReceipt(db, provider, first.id, date);
  await recordInspection(
    db,
    provider,
    intake.id,
    { expectedRevision: 0, condition: 'fair', usageValue: 15_200, hoursSinceService: null },
    date
  );
  let revision = 1;
  for (const actionId of ['battery_replacement', 'safety_inspection', 'upgrade:fair->good']) {
    const work = await recordWork(
      db,
      provider,
      intake.id,
      { expectedRevision: revision, actionId },
      date
    );
    revision = work.revision;
  }
  await relist(db, provider, intake.id, { expectedRevision: revision }, date);
  await sign('ebike-003', date);
  const passport = await loadPassport(db, 'ebike-003');
  expect(passport).toMatchObject({
    earlierLives: 0,
    totals: { lives: 2, estimatedLives: 2, refurbishmentCents: 51_500 },
  });
  expect(passport?.lives[0]).toMatchObject({
    number: 1,
    ending: 'returned',
    priceSource: 'price_list',
    returned: { condition: 'fair', usage: { value: 15_200 } },
    refurbishment: [
      { actionId: 'battery_replacement', costCents: 35_000 },
      { actionId: 'safety_inspection', costCents: 4_500 },
      { actionId: 'upgrade:fair->good', costCents: 12_000 },
    ],
  });
  expect(passport?.lives[1]).toMatchObject({
    number: 2,
    ending: 'active',
    priceSource: 'next_life',
    start: { condition: 'good', usage: { value: 0 } },
  });
});

it('returns no passport for an unknown asset', async () => {
  expect(await loadPassport(db, 'missing')).toBeNull();
});

it('uses locked scalar prices for legacy lives and ignores audits without a valid matching reading', async () => {
  const signed = await sign('ebike-002', '2026-11-05');
  await db.contractLine.deleteMany({ where: { contractId: signed.id } });
  await db.contractLifecycle.delete({ where: { contractId: signed.id } });
  await db.auditLog.deleteMany({ where: { entity_id: signed.id } });
  for (const details_json of [
    null,
    '{}',
    JSON.stringify({
      assetId: 'another-bike',
      assetAtSigning: { condition: 'good', usage: { unit: 'km', value: 0 } },
    }),
  ]) {
    await db.auditLog.create({
      data: {
        actor: 'Private identity',
        action: 'contract.signed',
        entity_type: 'contract',
        entity_id: signed.id,
        details_json,
      },
    });
  }
  expect(await loadPassport(db, 'ebike-002')).toMatchObject({
    lives: [
      {
        ending: 'active',
        start: null,
        monthlyNetCents: signed.monthlyNetCents,
        estimatedCo2SavingGrams: null,
      },
    ],
  });
  await db.assetLifeCompletion.create({
    data: {
      id: 'legacy-life',
      contractId: signed.id,
      assetId: 'ebike-002',
      kind: 'pass_on',
      completedOn: '2027-01-01',
    },
  });
  expect((await loadPassport(db, 'ebike-002'))?.lives[0]?.ending).toBe('passed_on');
  await db.assetLifeCompletion.update({ where: { id: 'legacy-life' }, data: { kind: 'buyout' } });
  expect((await loadPassport(db, 'ebike-002'))?.lives[0]?.ending).toBe('bought_out');
  await db.assetLifeCompletion.delete({ where: { id: 'legacy-life' } });
  for (const [status, actualEndOn, ending] of [
    ['passed_on', '2027-01-01', 'passed_on'],
    ['completed_buyout', '2027-01-01', 'bought_out'],
    ['completed_return', '2027-01-01', 'exited_early'],
    ['completed_return', signed.endOn, 'returned'],
  ]) {
    await db.contractLifecycle.upsert({
      where: { contractId: signed.id },
      create: { contractId: signed.id, status: status!, actualEndOn },
      update: { status, actualEndOn },
    });
    const passport = await loadPassport(db, 'ebike-002');
    expect(passport?.lives[0]).toMatchObject({ ending, endOn: actualEndOn });
    expect(JSON.stringify(passport)).not.toContain('Private identity');
  }
});
