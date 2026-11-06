import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAssets } from '@/data/load';
import { POST, GET } from '@/app/api/contracts/[id]/exit/route';
import { createTestDb } from '../../tests/helpers/test-db';
import { demoNameCookieHeader } from './demo-cookie';
import { seedAssets } from './assets';
import { readExitView, requestEarlyExit, withdrawEarlyExit } from './exit-requests';
import { acknowledgeEarlyExit, finalizeDueReturns } from './exit-completion';
import { runLifecycleTick } from './lifecycle-worker';
import type { PrismaClient } from './prisma-client';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
vi.mock('@/server/today', () => ({ todayIso: () => '2026-07-31' }));

let db: PrismaClient;
let cleanup: () => Promise<void>;
const on = '2026-07-31';
const boundary = '2026-08-31';
const context = { params: Promise.resolve({ id: 'contract' }) };

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.contract.deleteMany();
  await db.demoUser.deleteMany();
  await db.asset.deleteMany();
  await db.auditLog.deleteMany();
  await seedAssets(db, await loadAssets());
  await db.demoUser.createMany({
    data: ['renter', 'provider', 'other'].map((id) => ({
      id,
      canonicalUsername: id,
      displayName: id,
    })),
  });
  await db.asset.updateMany({
    where: { id: { in: ['ebike-003', 'ebike-004'] } },
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
      actor: 'Original applicant',
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

async function request(kind: 'return' | 'buyout' = 'return') {
  const view = await readExitView(db, 'contract', 'renter', on);
  const priced = kind === 'return' ? view.returnQuote : view.buyoutQuote;
  if (!priced.ok) throw new Error('Expected quote');
  const input = {
    requestId: randomUUID(),
    contractId: 'contract',
    userId: 'renter',
    kind,
    expectedQuote: priced.quote,
  };
  return { input, exit: await requestEarlyExit(db, input, on) };
}

const acknowledgment = (id: string, revision = 0) => ({
  exitId: id,
  userId: 'provider',
  expectedRevision: revision,
  balancesReviewed: true,
  assetIds: ['ebike-003'],
});

describe('audited exit requests', () => {
  it('scopes reads and quotes to stable participants rather than the applicant name', async () => {
    expect(await readExitView(db, 'contract', 'renter', on)).toMatchObject({
      role: 'renter',
      returnQuote: { ok: true, quote: { amountNetCents: 155585 } },
    });
    expect(await readExitView(db, 'contract', 'provider', on)).toMatchObject({
      role: 'provider',
      returnQuote: { ok: false, reason: 'not_renter' },
    });
    await expect(readExitView(db, 'contract', 'Original applicant', on)).rejects.toMatchObject({
      code: 'NOT_PARTICIPANT',
    });
    await expect(readExitView(db, 'missing', 'renter', on)).rejects.toMatchObject({
      code: 'CONTRACT_NOT_FOUND',
    });
  });

  it('freezes a reviewed quote, rejects conflicts and makes request retries idempotent', async () => {
    const before = await db.contract.findUniqueOrThrow({ where: { id: 'contract' } });
    const { input, exit } = await request();
    expect(exit).toMatchObject({ status: 'pending', effectiveEndOn: boundary });
    expect(await requestEarlyExit(db, input, on)).toEqual(exit);
    expect(await db.exitRequest.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'exit.requested' } })).toBe(1);
    await expect(
      requestEarlyExit(db, { ...input, requestId: randomUUID() }, on)
    ).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    await expect(requestEarlyExit(db, { ...input, kind: 'buyout' }, on)).rejects.toMatchObject({
      code: 'REQUEST_ID_CONFLICT',
    });
    const refreshed = await readExitView(db, 'contract', 'renter', on);
    if (!refreshed.returnQuote.ok) throw new Error('Expected quote');
    await expect(
      requestEarlyExit(
        db,
        { ...input, requestId: randomUUID(), expectedQuote: refreshed.returnQuote.quote },
        on
      )
    ).rejects.toMatchObject({ code: 'EXIT_PENDING' });
    expect(await db.contract.findUnique({ where: { id: 'contract' } })).toEqual(before);
  });

  it('rejects stale amounts and missing ownership before writing', async () => {
    const view = await readExitView(db, 'contract', 'renter', on);
    if (!view.returnQuote.ok) throw new Error('Expected quote');
    const input = {
      requestId: randomUUID(),
      contractId: 'contract',
      userId: 'renter',
      kind: 'return' as const,
      expectedQuote: { ...view.returnQuote.quote, amountNetCents: 1 },
    };
    await expect(requestEarlyExit(db, input, on)).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    await db.asset.update({ where: { id: 'ebike-003' }, data: { ownerId: 'other' } });
    await expect(
      requestEarlyExit(db, { ...input, expectedQuote: view.returnQuote.quote }, on)
    ).rejects.toMatchObject({ code: 'ASSET_CHANGED' });
    expect(await db.exitRequest.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it('allows only an unprocessed request to be withdrawn by its renter', async () => {
    const { exit } = await request();
    await expect(withdrawEarlyExit(db, exit.id, 'provider', 0)).rejects.toMatchObject({
      code: 'NOT_RENTER',
    });
    await expect(withdrawEarlyExit(db, exit.id, 'renter', 1)).rejects.toMatchObject({
      code: 'EXIT_CHANGED',
    });
    expect(await withdrawEarlyExit(db, exit.id, 'renter', 0)).toMatchObject({
      status: 'withdrawn',
      openContractId: null,
    });
    expect(await withdrawEarlyExit(db, exit.id, 'renter', 0)).toMatchObject({
      status: 'withdrawn',
    });
    expect(await db.auditLog.count({ where: { action: 'exit.withdrawn' } })).toBe(1);
    const next = (await request('buyout')).exit;
    expect(next.status).toBe('pending');
    await acknowledgeEarlyExit(db, acknowledgment(next.id), on);
    expect((await readExitView(db, 'contract', 'renter', on)).request?.id).toBe(next.id);
  });
});

describe('provider confirmation and completion', () => {
  it('holds a received return until period-end, then finalizes it exactly once', async () => {
    const original = await db.contract.findUniqueOrThrow({ where: { id: 'contract' } });
    const { exit } = await request();
    expect(await acknowledgeEarlyExit(db, acknowledgment(exit.id), on)).toMatchObject({
      status: 'received',
    });
    expect(
      await db.contractLifecycle.findUnique({ where: { contractId: 'contract' } })
    ).toMatchObject({ status: 'active' });
    expect(await finalizeDueReturns(db, '2026-08-30')).toEqual({ completed: 0, failedIds: [] });
    expect(await runLifecycleTick(db, boundary)).toEqual({ completed: 1, failedIds: [] });
    expect(await finalizeDueReturns(db, boundary)).toEqual({ completed: 0, failedIds: [] });
    expect(
      await db.contractLifecycle.findUnique({ where: { contractId: 'contract' } })
    ).toMatchObject({ status: 'completed_return', actualEndOn: boundary });
    expect(await db.asset.findUnique({ where: { id: 'ebike-003' } })).toMatchObject({
      status: 'returned',
      ownerId: 'provider',
      previous_lives: 1,
    });
    expect(await db.assetLifeCompletion.count()).toBe(1);
    expect(await acknowledgeEarlyExit(db, acknowledgment(exit.id), boundary)).toMatchObject({
      status: 'completed',
    });
    expect(await db.contract.findUnique({ where: { id: 'contract' } })).toEqual(original);
  });

  it('does not complete an overdue unreceived item or accept renter receipt/payment', async () => {
    const { exit } = await request();
    expect(await finalizeDueReturns(db, '2027-01-01')).toEqual({ completed: 0, failedIds: [] });
    await expect(
      acknowledgeEarlyExit(db, { ...acknowledgment(exit.id), userId: 'renter' }, on)
    ).rejects.toMatchObject({ code: 'NOT_PROVIDER' });
    await expect(
      acknowledgeEarlyExit(db, { ...acknowledgment(exit.id), balancesReviewed: false }, on)
    ).rejects.toMatchObject({ code: 'REVIEW_REQUIRED' });
    await expect(
      acknowledgeEarlyExit(db, { ...acknowledgment(exit.id), assetIds: ['foreign'] }, on)
    ).rejects.toMatchObject({ code: 'INVALID_RECEIPT' });
    await acknowledgeEarlyExit(db, acknowledgment(exit.id), on);
    await expect(withdrawEarlyExit(db, exit.id, 'renter', 1)).rejects.toMatchObject({
      code: 'EXIT_CHANGED',
    });
    expect(await db.assetLifeCompletion.count()).toBe(0);
  });

  it('completes a buyout only on provider acknowledgment and retains a nonleasable asset', async () => {
    const { exit } = await request('buyout');
    expect(JSON.parse(exit.quoteJson)).toMatchObject({ amountNetCents: 369520 });
    expect(await db.asset.findUnique({ where: { id: 'ebike-003' } })).toMatchObject({
      ownerId: 'provider',
    });
    expect(await acknowledgeEarlyExit(db, acknowledgment(exit.id), on)).toMatchObject({
      status: 'completed',
      completedBy: 'provider',
    });
    expect(
      await db.contractLifecycle.findUnique({ where: { contractId: 'contract' } })
    ).toMatchObject({ status: 'completed_buyout', actualEndOn: on });
    expect(await db.asset.findUnique({ where: { id: 'ebike-003' } })).toMatchObject({
      status: 'reserved',
      ownerId: 'renter',
      previous_lives: 1,
    });
    await acknowledgeEarlyExit(db, acknowledgment(exit.id), on);
    expect(await db.assetLifeCompletion.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'exit.buyout_paid' } })).toBe(1);
  });

  it('tracks separate bundle receipts but completes all assets together', async () => {
    const first = await db.contractLine.findUniqueOrThrow({ where: { id: 'line-1' } });
    const { id: _id, contractId: _contractId, assetId: _assetId, ...price } = first;
    await db.contractLine.create({
      data: { id: 'line-2', contractId: 'contract', assetId: 'ebike-004', ...price },
    });
    await db.contract.update({
      where: { id: 'contract' },
      data: { monthlyNetCents: 21460, buyoutNetCents: 116700 },
    });
    const { exit } = await request();
    await acknowledgeEarlyExit(db, acknowledgment(exit.id), boundary);
    expect(await db.assetLifeCompletion.count()).toBe(0);
    const audits = await db.auditLog.count();
    expect(await finalizeDueReturns(db, boundary)).toEqual({ completed: 0, failedIds: [] });
    expect(await db.auditLog.count()).toBe(audits);
    await acknowledgeEarlyExit(
      db,
      { ...acknowledgment(exit.id, 1), assetIds: ['ebike-004'] },
      boundary
    );
    expect(await db.assetLifeCompletion.count()).toBe(2);
    expect(await db.exitRequest.findUnique({ where: { id: exit.id } })).toMatchObject({
      status: 'completed',
    });
  });

  it('rolls back request/revision and buyout ownership/lives if audit persistence fails', async () => {
    const failing = db.$extends({
      query: {
        auditLog: {
          create() {
            throw new Error('audit unavailable');
          },
        },
      },
    }) as unknown as PrismaClient;
    const view = await readExitView(db, 'contract', 'renter', on);
    if (!view.returnQuote.ok) throw new Error('Expected quote');
    await expect(
      requestEarlyExit(
        failing,
        {
          requestId: randomUUID(),
          contractId: 'contract',
          userId: 'renter',
          kind: 'return',
          expectedQuote: view.returnQuote.quote,
        },
        on
      )
    ).rejects.toThrow('audit unavailable');
    expect(await db.exitRequest.count()).toBe(0);
    expect(
      await db.contractLifecycle.findUnique({ where: { contractId: 'contract' } })
    ).toMatchObject({ revision: 0 });
    const { exit } = await request('buyout');
    await expect(acknowledgeEarlyExit(failing, acknowledgment(exit.id), on)).rejects.toThrow(
      'audit unavailable'
    );
    expect(await db.assetLifeCompletion.count()).toBe(0);
    expect(await db.asset.findUnique({ where: { id: 'ebike-003' } })).toMatchObject({
      ownerId: 'provider',
      previous_lives: 0,
    });
    expect(await db.exitRequest.findUnique({ where: { id: exit.id } })).toMatchObject({
      status: 'pending',
    });
  });
});

it('API requires a demo sign-in name, validates shape, and returns the common envelope', async () => {
  const http = (body: unknown, user = 'renter') =>
    new Request('http://localhost/api/contracts/contract/exit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: demoNameCookieHeader(user) },
      body: JSON.stringify(body),
    });
  expect((await GET(new Request('http://localhost'), context)).status).toBe(401);
  expect(
    (
      await GET(
        new Request('http://localhost', { headers: { cookie: demoNameCookieHeader('other') } }),
        context
      )
    ).status
  ).toBe(403);
  const view = await readExitView(db, 'contract', 'renter', on);
  if (!view.returnQuote.ok) throw new Error('Expected quote');
  const payload = {
    action: 'request',
    requestId: randomUUID(),
    kind: 'return',
    expectedQuote: view.returnQuote.quote,
  };
  expect((await POST(http({ ...payload, actor: 'fake' }), context)).status).toBe(400);
  const response = await POST(http(payload), context);
  expect(response.status).toBe(201);
  const json = await response.json();
  expect(json).toMatchObject({
    success: true,
    data: { status: 'pending' },
    meta: { timestamp: expect.any(String) },
  });
  const wrong = await POST(
    http(
      { action: 'paid', exitId: json.data.id, expectedRevision: 0, balancesReviewed: true },
      'provider'
    ),
    context
  );
  expect(wrong.status).toBe(422);
  expect(await wrong.json()).toMatchObject({ error: { code: 'INVALID_EXIT_ACTION' } });
  const outside = await POST(
    http({ action: 'withdraw', exitId: json.data.id, expectedRevision: 0 }),
    { params: Promise.resolve({ id: 'elsewhere' }) }
  );
  expect(outside.status).toBe(404);
});

describe('completion guards and worker recovery', () => {
  it('rejects a missing request, missing receipts, stale revisions and withdrawn requests', async () => {
    await expect(acknowledgeEarlyExit(db, acknowledgment('missing'), on)).rejects.toMatchObject({
      code: 'EXIT_NOT_FOUND',
    });
    const { exit } = await request();
    const { assetIds: _assetIds, ...withoutReceipts } = acknowledgment(exit.id);
    await expect(acknowledgeEarlyExit(db, withoutReceipts, on)).rejects.toMatchObject({
      code: 'INVALID_RECEIPT',
    });
    await expect(acknowledgeEarlyExit(db, acknowledgment(exit.id, 10), on)).rejects.toMatchObject({
      code: 'EXIT_CHANGED',
    });
    await withdrawEarlyExit(db, exit.id, 'renter', 0);
    await expect(acknowledgeEarlyExit(db, acknowledgment(exit.id), on)).rejects.toMatchObject({
      code: 'EXIT_CHANGED',
    });
    expect(await db.exitReceipt.count()).toBe(0);
  });

  it('does not acknowledge receipts against an already completed lease', async () => {
    const { exit } = await request();
    await db.contractLifecycle.update({
      where: { contractId: 'contract' },
      data: { status: 'completed_buyout' },
    });
    await expect(acknowledgeEarlyExit(db, acknowledgment(exit.id), on)).rejects.toMatchObject({
      code: 'CONTRACT_COMPLETED',
    });
    expect(await db.exitReceipt.count()).toBe(0);
  });

  it('makes duplicate physical receipts idempotent even with the old revision', async () => {
    const { exit } = await request();
    const received = await acknowledgeEarlyExit(db, acknowledgment(exit.id), on);
    const audits = await db.auditLog.count();
    expect(await acknowledgeEarlyExit(db, acknowledgment(exit.id), on)).toEqual(received);
    expect(await db.exitReceipt.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(audits);
  });

  it('holds a return while an uncompleted pass-on exists and rolls back its receipt', async () => {
    const { exit } = await request();
    await db.endTermChoice.create({
      data: { contractId: 'contract', kind: 'pass_on', nomineeId: 'other', requestedOn: on },
    });
    await expect(acknowledgeEarlyExit(db, acknowledgment(exit.id), boundary)).rejects.toMatchObject(
      { code: 'EXIT_CHANGED' }
    );
    expect(await db.exitReceipt.count()).toBe(0);
    expect(await db.exitRequest.findUnique({ where: { id: exit.id } })).toMatchObject({
      status: 'pending',
      revision: 0,
    });
  });

  it.each(['exit', 'lifecycle'])(
    'rolls back if the %s completes between the initial check and finalization',
    async (changed) => {
      const { exit } = await request();
      let reads = 0;
      const racing = (changed === 'exit'
        ? db.$extends({
            query: {
              exitRequest: {
                async findUniqueOrThrow({ args, query }) {
                  const row = await query(args);
                  return ++reads === 2 ? { ...row, status: 'completed' } : row;
                },
              },
            },
          })
        : db.$extends({
            query: {
              contract: {
                async findUnique({ args, query }) {
                  const row = await query(args);
                  return ++reads === 2 && row
                    ? { ...row, lifecycle: { status: 'completed_return', revision: 9 } }
                    : row;
                },
              },
            },
          })) as unknown as PrismaClient;
      await expect(
        acknowledgeEarlyExit(racing, acknowledgment(exit.id), boundary)
      ).rejects.toMatchObject({ code: changed === 'exit' ? 'EXIT_CHANGED' : 'CONTRACT_COMPLETED' });
      expect(await db.exitReceipt.count()).toBe(0);
      expect(await db.assetLifeCompletion.count()).toBe(0);
    }
  );

  it('reports a failed worker transaction, preserves legacy scalar leases, and succeeds on retry', async () => {
    const { exit } = await request();
    await acknowledgeEarlyExit(db, acknowledgment(exit.id), on);
    await db.contractLine.deleteMany();
    const failing = db.$extends({
      query: {
        auditLog: {
          create() {
            throw new Error('audit unavailable');
          },
        },
      },
    }) as unknown as PrismaClient;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await finalizeDueReturns(failing, boundary)).toEqual({
        completed: 0,
        failedIds: [exit.id],
      });
      expect(error).toHaveBeenCalled();
      expect(await db.assetLifeCompletion.count()).toBe(0);
      expect(await db.exitRequest.findUnique({ where: { id: exit.id } })).toMatchObject({
        status: 'received',
      });
      expect(await finalizeDueReturns(db, boundary)).toEqual({ completed: 1, failedIds: [] });
    } finally {
      error.mockRestore();
    }
  });

  it('ignores a worker race when another finalization has already won', async () => {
    const { exit } = await request();
    await acknowledgeEarlyExit(db, acknowledgment(exit.id), on);
    const racing = db.$extends({
      query: {
        exitRequest: {
          async findUniqueOrThrow({ args, query }) {
            return { ...(await query(args)), status: 'completed' };
          },
        },
      },
    }) as unknown as PrismaClient;
    expect(await finalizeDueReturns(racing, boundary)).toEqual({ completed: 0, failedIds: [] });
    expect(await db.auditLog.count({ where: { action: 'exit.return_finalized' } })).toBe(0);
  });
});
