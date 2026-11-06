import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets, loadCoefficientTable, loadPriceLists } from '@/data/load';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { signContract } from './contracts';
import { seedDemoParticipants } from './demo-participants';
import { seedDealerSide } from './providers';
import { loadLeaseActivity } from './lease-activity';
import type { PrismaClient } from './prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
let lists: Awaited<ReturnType<typeof loadPriceLists>>;
let table: Awaited<ReturnType<typeof loadCoefficientTable>>;

const viewer = { id: 'cust-aino', displayName: 'Aino Virtanen' };
const signing = {
  assetId: 'ebike-003',
  actor: 'Aino Virtanen',
  termMonths: 36,
  downPaymentCents: 0,
  expectedMonthlyNetCents: 10730,
  expectedBuyoutNetCents: 58350,
  expectedPriceListVersion: 1,
  participants: {
    renterId: 'cust-aino',
    providerId: 'provider-kettu',
    providerName: 'Kettu Mobility Oy',
    locale: 'en' as const,
  },
};

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  [lists, table] = await Promise.all([loadPriceLists(), loadCoefficientTable()]);
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.auditLog.deleteMany();
  await db.rating.deleteMany();
  await db.contract.deleteMany();
  await db.asset.deleteMany();
  await seedAssets(db, await loadAssets());
  await seedDemoParticipants(db);
});

const audit = (entity_type: string, entity_id: string, action: string, actor: string) =>
  db.auditLog.create({ data: { entity_type, entity_id, action, actor } });

describe('loadLeaseActivity', () => {
  it("shows the lease's own history and leaves out other leases", async () => {
    const mine = await signContract(db, signing, '2026-11-05', lists, table);
    await audit('contract', 'someone-elses-contract', 'invoices.generated', 'cust-mikko');

    const items = await loadLeaseActivity(db, mine.id, viewer);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      actor: { kind: 'you' },
      event: { type: 'signed', termMonths: 36, monthlyNetCents: 10730 },
    });
  });

  it("includes ratings, but not one a moderator hid that the viewer didn't write", async () => {
    const mine = await signContract(db, signing, '2026-11-05', lists, table);
    const rating = (id: string, reviewerId: string, visibility: string) =>
      db.rating.create({
        data: {
          id,
          contractId: mine.id,
          reviewerId,
          subjectId: reviewerId === 'cust-aino' ? 'provider-kettu' : 'cust-aino',
          direction: reviewerId === 'cust-aino' ? 'renter_to_provider' : 'provider_to_renter',
          stars: 4,
          visibility,
        },
      });
    await rating('mine', 'cust-aino', 'hidden');
    await rating('theirs', 'provider-kettu', 'hidden');
    await audit('rating', 'mine', 'rating.created', 'cust-aino');
    await audit('rating', 'theirs', 'rating.created', 'provider-kettu');

    const items = await loadLeaseActivity(db, mine.id, viewer);
    expect(items.filter((item) => item.event.type === 'rated').map((item) => item.actor)).toEqual([
      { kind: 'you' },
    ]);
  });

  it('names the other participant', async () => {
    await seedDealerSide(db, await loadAssets());
    const mine = await signContract(db, signing, '2026-11-05', lists, table);
    const exit = await db.exitRequest.create({
      data: {
        id: '00000000-0000-4000-8000-000000000009',
        contractId: mine.id,
        renterId: 'cust-aino',
        providerId: 'provider-kettu',
        kind: 'buyout',
        status: 'completed',
        requestedOn: '2026-11-06',
        effectiveEndOn: '2026-12-05',
        quoteJson: '{}',
      },
    });
    await audit('exit', exit.id, 'exit.buyout_paid', 'provider-kettu');
    const items = await loadLeaseActivity(db, mine.id, viewer);
    expect(items.find((item) => item.event.type === 'buyout_paid')?.actor).toEqual({
      kind: 'person',
      name: 'Kettu Mobility Oy',
    });
  });
});
