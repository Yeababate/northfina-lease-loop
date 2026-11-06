import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { POST as assign } from '@/app/api/returns/[id]/assign/route';
import { GET as matches } from '@/app/api/returns/[id]/matches/route';
import { loadAssets } from '@/data/load';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { recordInspection, recordWork, relist } from './next-life-commands';
import type { PrismaClient } from './prisma-client';
import { seedDealerSide } from './providers';
import { seedWaitingList } from './waiting-list';

let db: PrismaClient;
let cleanup: () => Promise<void>;
const today = '2026-11-05';
const provider = 'provider-kettu';
const intake = 'seed-ebike-007';
const context = { params: Promise.resolve({ id: intake }) };

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
vi.mock('@/server/today', () => ({ todayIso: () => today }));

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await seedDealerSide(db, assets);
  await seedWaitingList(db);
});
afterAll(async () => {
  await cleanup();
});

function request(actor: string, entryId?: string) {
  return new Request('http://localhost/api/returns', {
    method: entryId ? 'POST' : 'GET',
    headers: { Cookie: `lease-loop-provider=${actor}`, 'Content-Type': 'application/json' },
    body: entryId ? JSON.stringify({ entryId }) : undefined,
  });
}

it('proposes, reserves and audits the card 9 winner while blocking public relisting', async () => {
  await seedWaitingList(db);
  expect(await db.waitingListEntry.count()).toBe(14);
  expect((await matches(request('provider-pelto'), context)).status).toBe(404);
  expect((await matches(request(provider), context)).status).toBe(409);
  await recordInspection(
    db,
    provider,
    intake,
    {
      expectedRevision: 0,
      condition: 'fair',
      usageValue: 18_400,
      hoursSinceService: null,
    },
    today
  );

  const proposal = await matches(request(provider), context);
  expect(proposal.status).toBe(200);
  const { data } = await proposal.json();
  expect(data.decision.recommendation).toEqual({
    optionId: 'to_like_new',
    reason: 'best_net_value',
  });
  expect(data.ranked[0]).toMatchObject({
    entry: { id: 'wait-13' },
    option: { id: 'to_good', costCents: 51_500 },
    monthlyNetCents: 6_326,
    monthlyGrossCents: 7_939,
  });
  expect(data.rejected).toContainEqual({ entryId: 'wait-02', reason: 'over_budget' });

  expect((await assign(request(provider, 'wait-02'), context)).status).toBe(409);
  expect((await assign(request(provider, 'wait-13'), context)).status).toBe(201);
  expect(await db.waitingListEntry.findUnique({ where: { id: 'wait-13' } })).toMatchObject({
    status: 'offered',
    offeredAssetId: 'ebike-007',
    offeredIntakeId: intake,
  });
  expect((await assign(request(provider, 'wait-04'), context)).status).toBe(409);
  expect(await db.auditLog.count({ where: { action: 'return.waiting_list_offered' } })).toBe(1);

  let revision = 1;
  for (const actionId of ['battery_replacement', 'safety_inspection', 'upgrade:fair->good']) {
    const step = await recordWork(
      db,
      provider,
      intake,
      { expectedRevision: revision, actionId },
      today
    );
    revision = step.revision;
  }
  await expect(
    relist(db, provider, intake, { expectedRevision: revision }, today)
  ).rejects.toMatchObject({ code: 'ASSET_ALREADY_OFFERED' });
});
