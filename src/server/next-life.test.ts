import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as receiptRoute } from '@/app/api/outgoing/contracts/[id]/receipt/route';
import {
  DELETE as clearSession,
  GET as sessionRoute,
  POST as selectRoute,
} from '@/app/api/provider-session/route';
import { POST as inspectRoute } from '@/app/api/returns/[id]/inspection/route';
import { POST as relistRoute } from '@/app/api/returns/[id]/relist/route';
import { GET as detailRoute } from '@/app/api/returns/[id]/route';
import { POST as workRoute } from '@/app/api/returns/[id]/work/route';
import { GET as listRoute } from '@/app/api/returns/route';
import { loadAssets, loadCoefficientTable, loadPriceLists } from '@/data/load';
import { priceContract } from '@/domain/contract-pricing';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { signContract } from './contracts';
import { finalizeDueReturns, recordInspection, recordReceipt, relist } from './next-life-commands';
import type { PrismaClient } from './prisma-client';
import { providerIdFromCookie, seedDealerSide, seedOwnerOf } from './providers';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
let today = '2026-11-05';
vi.mock('@/server/today', () => ({ todayIso: () => today }));

let db: PrismaClient;
let cleanup: () => Promise<void>;
const KETTU = 'provider-kettu';
const PELTO = 'provider-pelto';

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  today = '2026-11-05';
  for (const table of [
    'assetLifecycleEvent',
    'refurbishmentWork',
    'returnInspection',
    'returnIntake',
    'contractProvider',
    'assetOwnership',
    'provider',
    'contract',
    'auditLog',
    'asset',
  ] as const)
    await (db[table] as unknown as { deleteMany: () => Promise<unknown> }).deleteMany();
  const assets = await loadAssets();
  await seedAssets(db, assets);
  await seedDealerSide(db, assets);
});

/** Signs ebike-003 (Kettu) from 2026-11-05; its exclusive end is 2027-11-05. */
async function signEbike() {
  const [lists, table] = await Promise.all([loadPriceLists(), loadCoefficientTable()]);
  const lease = { assetId: 'ebike-003', termMonths: 12, downPaymentCents: 0 };
  const priced = priceContract(lists, table, lease, '2026-11-05');
  if (!priced.ok) throw new Error('fixture lease must be priceable');
  return signContract(
    db,
    {
      assetId: 'ebike-003',
      actor: 'Aino Virtanen',
      termMonths: 12,
      downPaymentCents: 0,
      expectedMonthlyNetCents: priced.price.monthlyNetCents,
      expectedPriceListVersion: 1,
    },
    '2026-11-05',
    lists,
    table
  );
}

const as = (providerId: string | null, body?: unknown) =>
  new Request('http://localhost/api', {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(providerId ? { Cookie: `other=1; lease-loop-provider=${providerId}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (response: Response) => ({
  status: response.status,
  body: await response.json(),
});

describe('seed and provider context', () => {
  it('seeds two dealers, a dual-role customer, ownership and imported returns once', async () => {
    expect(await db.provider.count()).toBe(3);
    expect(await db.assetOwnership.count()).toBe(30);
    expect(seedOwnerOf({ id: 'ebike-005', category: 'e_bike' })).toBe('cust-aino');
    const imports = await db.returnIntake.findMany({ orderBy: { id: 'asc' } });
    expect(imports.map((i) => i.assetId)).toEqual([
      'ebike-007',
      'ebike-008',
      'ebike-011',
      'farm-005',
      'laptop-006',
      'laptop-007',
    ]);
    expect(imports.every((i) => i.contractId === null && i.receivedOn === null)).toBe(true);
    expect(await seedDealerSide(db, await loadAssets())).toEqual({
      providers: 0,
      ownership: 0,
      intakes: 0,
    });
  });

  it('reads only the named cookie and rejects malformed values', () => {
    expect(providerIdFromCookie('a=1; lease-loop-provider=provider-kettu')).toBe(KETTU);
    expect(providerIdFromCookie('lease-loop-provider=%E0%A4%A')).toBeNull();
    expect(providerIdFromCookie('lease-loop-provider=')).toBeNull();
    expect(providerIdFromCookie(null)).toBeNull();
  });

  it('selects, reads and clears the provider through the API', async () => {
    const selected = await selectRoute(as(null, { providerId: KETTU }), undefined);
    expect(selected.headers.get('set-cookie')).toContain('lease-loop-provider=provider-kettu');
    expect((await json(await sessionRoute(as(KETTU), undefined))).body.data).toMatchObject({
      id: KETTU,
    });
    expect((await selectRoute(as(null, { providerId: 'nobody' }), undefined)).status).toBe(404);
    expect((await clearSession(as(null), undefined)).headers.get('set-cookie')).toContain(
      'Max-Age=0'
    );
    expect(await json(await listRoute(as(null), undefined))).toMatchObject({
      status: 401,
      body: { success: false, error: { code: 'PROVIDER_REQUIRED' } },
    });
  });
});

describe('receipt', () => {
  it('links the signed contract to its provider and lets only that provider receive it', async () => {
    const contract = await signEbike();
    expect(
      await db.contractProvider.findUnique({ where: { contractId: contract.id } })
    ).toMatchObject({ providerId: KETTU });
    const foreign = await json(await receiptRoute(as(PELTO, {}), ctx(contract.id)));
    expect(foreign).toMatchObject({ status: 404, body: { error: { code: 'CONTRACT_NOT_FOUND' } } });

    today = '2027-01-10';
    const early = await json(await receiptRoute(as(KETTU, {}), ctx(contract.id)));
    expect(early).toMatchObject({ status: 201, body: { data: { completed: false } } });
    expect(await db.asset.findUnique({ where: { id: 'ebike-003' } })).toMatchObject({
      status: 'returned',
      previous_lives: 0,
    });
    const again = await json(await receiptRoute(as(KETTU, {}), ctx(contract.id)));
    expect(again).toMatchObject({ status: 409, body: { error: { code: 'ALREADY_RECEIVED' } } });
  });

  it('refuses receipt before the lease starts and completes at the exclusive end', async () => {
    const contract = await signEbike();
    today = '2026-11-04';
    await expect(recordReceipt(db, KETTU, contract.id, today)).rejects.toMatchObject({
      code: 'LEASE_NOT_STARTED',
    });
    today = '2027-11-05';
    expect(await recordReceipt(db, KETTU, contract.id, today)).toMatchObject({ completed: true });
    expect((await db.asset.findUniqueOrThrow({ where: { id: 'ebike-003' } })).previous_lives).toBe(
      1
    );
  });
});

describe('the full next life of one e-bike', () => {
  it('goes received → held → inspected → work → finalized → relisted, once', async () => {
    const contract = await signEbike();
    today = '2027-06-01';
    const { id } = await recordReceipt(db, KETTU, contract.id, today);

    const inspected = await json(
      await inspectRoute(
        as(KETTU, {
          expectedRevision: 0,
          condition: 'fair',
          usageValue: 15_200,
          hoursSinceService: null,
        }),
        ctx(id)
      )
    );
    expect(inspected).toMatchObject({ status: 201, body: { data: { revision: 1 } } });

    const stale = await json(
      await workRoute(as(KETTU, { expectedRevision: 0, actionId: 'safety_inspection' }), ctx(id))
    );
    expect(stale).toMatchObject({ status: 409, body: { error: { code: 'REVISION_CHANGED' } } });

    let revision = 1;
    for (const actionId of ['battery_replacement', 'safety_inspection']) {
      const done = await json(
        await workRoute(as(KETTU, { expectedRevision: revision, actionId }), ctx(id))
      );
      expect(done.status).toBe(201);
      revision = done.body.data.revision;
    }
    const notReady = await json(
      await relistRoute(as(KETTU, { expectedRevision: revision }), ctx(id))
    );
    expect(notReady).toMatchObject({
      status: 409,
      body: {
        error: {
          code: 'NOT_READY',
          details: ['work_incomplete', 'condition_below_listing', 'lease_still_open'],
        },
      },
    });
    // The refused relist rolled back, including its revision claim.
    const upgrade = await json(
      await workRoute(
        as(KETTU, { expectedRevision: revision, actionId: 'upgrade:fair->good' }),
        ctx(id)
      )
    );
    revision = upgrade.body.data.revision;

    const held = await json(await detailRoute(as(KETTU), ctx(id)));
    expect(held.body.data).toMatchObject({
      stage: 'ready_to_relist',
      onHold: true,
      blockers: ['lease_still_open'],
      asset: { condition: 'good', usage: { value: 0 } },
    });
    expect(held.body.data.work[0]).toMatchObject({
      actionId: 'battery_replacement',
      usageBefore: 15_200,
      usageAfter: 0,
    });
    expect(JSON.stringify(held.body.data)).not.toContain('Aino');
    expect(JSON.stringify(held.body.data)).not.toContain('monthlyNetCents');

    today = '2027-11-05';
    const relisted = await json(
      await relistRoute(as(KETTU, { expectedRevision: revision }), ctx(id))
    );
    expect(relisted).toMatchObject({ status: 200, body: { data: { relistedOn: '2027-11-05' } } });
    expect(await finalizeDueReturns(db, today)).toBe(0);
    expect(await db.asset.findUnique({ where: { id: 'ebike-003' } })).toMatchObject({
      status: 'available',
      previous_lives: 1,
      condition: 'good',
    });
    const history = await json(await detailRoute(as(KETTU), ctx(id)));
    expect(history.body.data.history.map((e: { type: string }) => e.type)).toEqual([
      'received',
      'inspected',
      'work_recorded',
      'work_recorded',
      'work_recorded',
      'life_completed',
      'relisted',
    ]);
    expect(
      (await json(await listRoute(as(KETTU), undefined))).body.data.map((r: { id: string }) => r.id)
    ).not.toContain(id);
    // The item can be leased again by the normal signing flow.
    expect(await db.contract.count()).toBe(1);
  });
});

describe('scope, concurrency and rollback', () => {
  const ready = async () => {
    // ebike-008 is an imported good-condition return: no lease to wait for.
    await recordInspection(
      db,
      KETTU,
      'seed-ebike-008',
      { expectedRevision: 0, condition: 'good', usageValue: 9800, hoursSinceService: null },
      today
    );
    const work = await json(
      await workRoute(
        as(KETTU, { expectedRevision: 1, actionId: 'safety_inspection' }),
        ctx('seed-ebike-008')
      )
    );
    return work.body.data.revision as number;
  };

  it('lists only own stock and hides foreign intakes', async () => {
    const kettu = (await json(await listRoute(as(KETTU), undefined))).body.data;
    expect(kettu.map((r: { id: string }) => r.id)).toEqual([
      'seed-ebike-007',
      'seed-ebike-008',
      'seed-ebike-011',
      'seed-laptop-006',
      'seed-laptop-007',
    ]);
    expect(kettu[0]).toMatchObject({ stage: 'awaiting_inspection', onHold: false });
    expect((await json(await detailRoute(as(PELTO), ctx('seed-ebike-008')))).status).toBe(404);
    expect(
      (
        await json(
          await inspectRoute(
            as(PELTO, {
              expectedRevision: 0,
              condition: 'good',
              usageValue: 1,
              hoursSinceService: null,
            }),
            ctx('seed-ebike-008')
          )
        )
      ).status
    ).toBe(404);
  });

  it('stops managing an item once it is owned by someone else', async () => {
    await db.assetOwnership.update({
      where: { assetId: 'ebike-008' },
      data: { providerId: PELTO },
    });
    expect((await json(await detailRoute(as(KETTU), ctx('seed-ebike-008')))).status).toBe(404);
    expect((await json(await listRoute(as(KETTU), undefined))).body.data).toHaveLength(4);
  });

  it('refuses a relist after a competing reservation', async () => {
    const revision = await ready();
    await db.asset.update({ where: { id: 'ebike-008' }, data: { status: 'reserved' } });
    const result = await json(
      await relistRoute(as(KETTU, { expectedRevision: revision }), ctx('seed-ebike-008'))
    );
    expect(result).toMatchObject({
      status: 409,
      body: { error: { code: 'NOT_READY', details: ['asset_not_returned'] } },
    });
    expect(
      (await db.returnIntake.findUniqueOrThrow({ where: { id: 'seed-ebike-008' } })).relistedOn
    ).toBeNull();
  });

  it('rolls back every relist write when the audit insert fails', async () => {
    const revision = await ready();
    const failing = db.$extends({
      query: {
        auditLog: {
          create() {
            throw new Error('audit down');
          },
        },
      },
    });
    await expect(
      relist(
        failing as unknown as PrismaClient,
        KETTU,
        'seed-ebike-008',
        { expectedRevision: revision },
        today
      )
    ).rejects.toThrow('audit down');
    expect(await db.asset.findUnique({ where: { id: 'ebike-008' } })).toMatchObject({
      status: 'returned',
    });
    expect(
      await db.returnIntake.findUniqueOrThrow({ where: { id: 'seed-ebike-008' } })
    ).toMatchObject({ relistedOn: null, revision });
    expect(await db.assetLifecycleEvent.count({ where: { type: 'relisted' } })).toBe(0);
  });

  it('rejects invalid work, inspections and bodies with safe errors', async () => {
    const uninspected = await json(
      await workRoute(
        as(KETTU, { expectedRevision: 0, actionId: 'safety_inspection' }),
        ctx('seed-ebike-007')
      )
    );
    expect(uninspected).toMatchObject({
      status: 422,
      body: { error: { code: 'MISSING_INSPECTION' } },
    });
    const lower = await json(
      await inspectRoute(
        as(KETTU, {
          expectedRevision: 0,
          condition: 'fair',
          usageValue: 100,
          hoursSinceService: null,
        }),
        ctx('seed-ebike-007')
      )
    );
    expect(lower).toMatchObject({ status: 422, body: { error: { code: 'USAGE_DECREASED' } } });
    const bad = await json(
      await inspectRoute(
        as(KETTU, {
          expectedRevision: 0,
          condition: 'shiny',
          usageValue: 1,
          hoursSinceService: null,
        }),
        ctx('seed-ebike-007')
      )
    );
    expect(bad).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_ERROR' } } });
    expect(await db.returnInspection.count()).toBe(0);
  });
});
