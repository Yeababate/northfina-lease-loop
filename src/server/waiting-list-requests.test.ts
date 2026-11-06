import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/waiting-list/route';
import { createTestDb } from '../../tests/helpers/test-db';
import { demoNameCookieHeader } from './demo-cookie';
import { seedDemoParticipants } from './demo-participants';
import type { PrismaClient } from './prisma-client';
import { myWaitingList } from './waiting-list-requests';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
vi.mock('@/server/today', () => ({ todayIso: () => '2026-11-06' }));

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.waitingListEntry.deleteMany();
  await seedDemoParticipants(db);
});

const join = (name: string | null, body: unknown) =>
  POST(
    new Request('http://localhost/api/waiting-list', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(name ? { cookie: demoNameCookieHeader(name) } : {}),
      },
      body: JSON.stringify(body),
    }),
    undefined
  );
const request = {
  category: 'e_bike',
  maxMonthlyNetRentCents: 9_000,
  minCondition: 'good',
  preferredTermMonths: 24,
  neededBy: '2026-12-01',
};

describe('joining the waiting list', () => {
  it('adds a request the matching can rank, owned by the customer and shown anonymously', async () => {
    const response = await join('aino', request);
    expect(response.status).toBe(201);
    const [entry] = await myWaitingList(db, 'cust-aino');
    expect(entry).toMatchObject({
      participantId: 'cust-aino',
      category: 'e_bike',
      status: 'waiting',
      signedUpOn: '2026-11-06',
      who: 'A Lease Loop customer',
    });
    expect(await db.auditLog.count({ where: { action: 'waiting_list.joined' } })).toBe(1);
  });

  it('needs a signed-in customer and a sensible request', async () => {
    expect((await join(null, request)).status).toBe(401);
    const bad = await join('aino', { ...request, preferredTermMonths: 30, neededBy: '2026-01-01' });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: { details: ['term', 'needed_by'] } });
    expect(await myWaitingList(db, 'cust-aino')).toEqual([]);
  });
});
