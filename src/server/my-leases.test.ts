import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets, loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { signContract } from './contracts';
import { seedDemoParticipants } from './demo-participants';
import { loadImpactInputs } from './impact';
import { loadMyLeases } from './my-leases';
import type { PrismaClient } from './prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let lists: Awaited<ReturnType<typeof loadPriceLists>>;
let table: Awaited<ReturnType<typeof loadCoefficientTable>>;
let vat: Awaited<ReturnType<typeof loadVatRates>>;

const participants = {
  renterId: 'cust-aino',
  providerId: 'provider-kettu',
  providerName: 'Kettu Mobility Oy',
  locale: 'en' as const,
};
const ebike = {
  assetId: 'ebike-003',
  actor: 'Aino',
  termMonths: 36,
  downPaymentCents: 0,
  expectedMonthlyNetCents: 10730,
  expectedBuyoutNetCents: 58350,
  expectedPriceListVersion: 1,
  participants,
};

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  [lists, table, vat] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
  ]);
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.exitRequest.deleteMany();
  await db.contract.deleteMany();
  await db.asset.deleteMany();
  await seedAssets(db, await loadAssets());
  await seedDemoParticipants(db);
});

describe('loadMyLeases', () => {
  it('sorts legacy leases without lines or documents, breaking equal start dates by id', async () => {
    const signed = await signContract(db, ebike, '2026-11-05', lists, table);
    await db.contractLine.deleteMany();
    await db.contractDocument.deleteMany();
    await db.contractLifecycle.deleteMany();
    await db.contract.create({
      data: { ...signed, id: '000-first', startOn: '2026-11-06', endOn: '2029-11-06' },
    });
    await db.contract.create({
      data: { ...signed, id: '000-second', startOn: '2026-11-06', endOn: '2029-11-06' },
    });
    const result = await loadMyLeases(db, 'cust-aino', '2026-12-01', { ...vat, rates: [] }, null);
    expect(result.current.map((card) => card.id)).toEqual(['000-first', '000-second', signed.id]);
    expect(result.current[0]).toMatchObject({
      items: [{ id: ebike.assetId, make: 'Nordvolt' }],
      hasDocument: false,
      monthlyGrossCents: null,
      nextInvoice: null,
    });
  });

  it('shows the pending company signatory without losing the locked quote', async () => {
    const signed = await signContract(
      db,
      { ...ebike, awaitingSignatory: 'signer@example.com' },
      '2026-11-05',
      lists,
      table
    );
    const result = await loadMyLeases(db, 'cust-aino', '2026-11-05', vat, null);
    expect(result.current[0]).toMatchObject({
      id: signed.id,
      awaitingSignatory: 'signer@example.com',
      monthlyNetCents: 10730,
    });
  });

  it('keeps a historical lease visible when its item details cannot be loaded', async () => {
    const signed = await signContract(db, ebike, '2026-11-05', lists, table);
    const unavailable = db.$extends({
      query: { asset: { findUnique: async () => null } },
    }) as unknown as PrismaClient;
    const result = await loadMyLeases(
      unavailable,
      'cust-aino',
      '2026-11-05',
      vat,
      await loadImpactInputs()
    );
    expect(result.current[0]).toMatchObject({
      id: signed.id,
      items: [{ id: ebike.assetId, make: null, model: null }],
    });
    expect(result.impact).toBeNull();
  });
  it('shows only your own leases, with what the card needs', async () => {
    const signed = await signContract(db, ebike, '2026-11-05', lists, table);
    const result = await loadMyLeases(db, 'cust-aino', '2026-12-10', vat, null);
    expect(result.current).toHaveLength(1);
    expect(result.past).toEqual([]);
    expect(result.impact).toBeNull();
    expect(result.current[0]).toMatchObject({
      id: signed.id,
      items: [{ id: 'ebike-003', make: 'Nordvolt', model: 'Trail 500' }],
      phase: 'active',
      endingEarly: false,
      month: 2,
      termMonths: 36,
      lastDay: '2029-11-04',
      monthlyNetCents: 10730,
      monthlyGrossCents: 13466,
      // The January invoice uses the 2027 VAT rate, not today's.
      nextInvoice: { invoiceDate: '2027-01-05', grossCents: 13520 },
      buyoutNetCents: 58350,
      hasDocument: true,
    });
    // Someone else, and the provider side of the same contract, see nothing here.
    expect((await loadMyLeases(db, 'cust-mikko', '2026-12-10', vat, null)).current).toEqual([]);
    expect((await loadMyLeases(db, 'provider-kettu', '2026-12-10', vat, null)).current).toEqual([]);
  });

  it('flags a lease with a pending early end', async () => {
    const signed = await signContract(db, ebike, '2026-11-05', lists, table);
    await db.exitRequest.create({
      data: {
        id: '00000000-0000-4000-8000-000000000001',
        contractId: signed.id,
        openContractId: signed.id,
        renterId: 'cust-aino',
        providerId: 'provider-kettu',
        kind: 'return',
        requestedOn: '2026-11-20',
        effectiveEndOn: '2026-12-05',
        quoteJson: '{}',
      },
    });
    const result = await loadMyLeases(db, 'cust-aino', '2026-11-20', vat, null);
    expect(result.current[0]?.endingEarly).toBe(true);
  });

  it('moves a completed lease to past leases, ending on its actual last day', async () => {
    const signed = await signContract(db, ebike, '2026-11-05', lists, table);
    await db.contractLifecycle.upsert({
      where: { contractId: signed.id },
      create: { contractId: signed.id, status: 'completed_return', actualEndOn: '2027-03-05' },
      update: { status: 'completed_return', actualEndOn: '2027-03-05' },
    });
    const result = await loadMyLeases(db, 'cust-aino', '2027-03-10', vat, null);
    expect(result.current).toEqual([]);
    expect(result.past[0]).toMatchObject({
      phase: 'ended',
      completed: true,
      lastDay: '2027-03-04',
    });
  });

  it('adds up the CO2 estimate over every leased item', async () => {
    await signContract(db, ebike, '2026-11-05', lists, table);
    const inputs = await loadImpactInputs();
    const result = await loadMyLeases(db, 'cust-aino', '2026-11-05', vat, inputs);
    expect(result.impact).toMatchObject({ estimatedCount: 1, unavailableCount: 0, partial: false });
    expect(result.impact?.totalSavingGrams).toBeGreaterThan(0);
  });

  it('is empty for someone who has not leased anything', async () => {
    const inputs = await loadImpactInputs();
    expect(await loadMyLeases(db, 'cust-aino', '2026-11-05', vat, inputs)).toEqual({
      current: [],
      past: [],
      impact: null,
    });
  });
});
