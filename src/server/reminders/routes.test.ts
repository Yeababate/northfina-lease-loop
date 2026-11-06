// The reminder and inbox API routes: shared envelope, recipient scope, safe errors.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getReminders, PUT as putReminders } from '@/app/api/contracts/[id]/reminders/route';
import { GET as getOne } from '@/app/api/notifications/[id]/route';
import { POST as readOne } from '@/app/api/notifications/[id]/read/route';
import { POST as readAll } from '@/app/api/notifications/read-all/route';
import { GET as getInbox } from '@/app/api/notifications/route';
import { defaultReminderPreferences } from '@/domain/reminder-preferences';
import { clearReminderData, seedLease } from '../../../tests/helpers/reminders';
import { createTestDb } from '../../../tests/helpers/test-db';
import type { PrismaClient } from '../prisma-client';
import { runReminderPass } from './processor';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
const customer = vi.hoisted(() => ({ id: 'cust-aino' as string | null }));
// The signed-in participant; reminders belong to their stable id.
vi.mock('@/server/current-principal', () => ({
  currentPrincipal: async () =>
    customer.id
      ? { id: customer.id, displayName: customer.id, canonicalUsername: customer.id }
      : null,
}));

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  customer.id = 'cust-aino';
  await clearReminderData(db);
  // A lease far in the future, so the PUT (which uses the real clock) can save reminders.
  await seedLease(db, { id: 'c1', endOn: '2030-12-05', savedAt: new Date('2026-11-01') });
  await runReminderPass(db, new Date('2030-11-05T07:00:00.000Z'), {
    contacts: async () => ({ email: 'aino@example.com' }),
  });
});

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const body = async (response: Response) => response.json() as Promise<Record<string, unknown>>;
const req = (method: string, json?: unknown) =>
  new Request('http://localhost/api', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: json === undefined ? undefined : JSON.stringify(json),
  });

describe('reminder settings routes', () => {
  it('returns the own settings and saves an edit with the expected revision', async () => {
    const got = await getReminders(req('GET'), ctx({ id: 'c1' }));
    expect(got.status).toBe(200);
    expect(await body(got)).toMatchObject({ success: true, data: { revision: 1 } });
    const preferences = { ...defaultReminderPreferences('Europe/Stockholm'), enabled: false };
    const saved = await putReminders(
      req('PUT', { expectedRevision: 1, preferences, locale: 'sv' }),
      ctx({ id: 'c1' })
    );
    expect(await body(saved)).toMatchObject({
      success: true,
      data: { revision: 2, locale: 'sv', preferences: { enabled: false } },
    });
    const stale = await putReminders(
      req('PUT', { expectedRevision: 1, preferences }),
      ctx({ id: 'c1' })
    );
    expect(stale.status).toBe(409);
    const invalid = await putReminders(req('PUT', { expectedRevision: 2 }), ctx({ id: 'c1' }));
    expect(invalid.status).toBe(400);
  });

  it('hides another customer’s lease and needs a customer', async () => {
    customer.id = 'cust-lena';
    expect((await getReminders(req('GET'), ctx({ id: 'c1' }))).status).toBe(404);
    customer.id = null;
    const anonymous = await getReminders(req('GET'), ctx({ id: 'c1' }));
    expect(anonymous.status).toBe(401);
    expect(await body(anonymous)).toMatchObject({ error: { code: 'NO_DEMO_NAME' } });
  });
});

describe('inbox routes', () => {
  it('lists, opens and marks the own notifications read', async () => {
    const inbox = (await body(await getInbox(req('GET'), undefined))) as {
      data: { unreadCount: number; items: { id: string }[] };
    };
    expect(inbox.data.unreadCount).toBe(1);
    const id = inbox.data.items[0]!.id;
    const one = await getOne(req('GET'), ctx({ id }));
    expect(await body(one)).toMatchObject({ data: { id, deliveries: expect.any(Array) } });
    expect((await readOne(req('POST'), ctx({ id }))).status).toBe(200);
    expect(await body(await readAll(req('POST'), undefined))).toMatchObject({
      data: { marked: 0 },
    });
    customer.id = 'cust-lena';
    expect((await getOne(req('GET'), ctx({ id }))).status).toBe(404);
    expect((await readOne(req('POST'), ctx({ id }))).status).toBe(404);
  });
});
