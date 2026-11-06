import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/waiting-list/[id]/still-wanted/route';
import { clearReminderData, seedLease } from '../../tests/helpers/reminders';
import { createTestDb } from '../../tests/helpers/test-db';
import { demoNameCookieHeader } from './demo-cookie';
import { seedDemoParticipants } from './demo-participants';
import type { PrismaClient } from './prisma-client';
import { getNotification, listInbox } from './reminders/inbox';
import type { ReminderContacts } from './reminders/processor';
import {
  answerStillWanted,
  renderStillWantedEmail,
  runWaitingListFollowUp,
  STILL_WANTED_KIND,
} from './waiting-list-follow-up';
import { myWaitingList, myWaitingListEntry } from './waiting-list-requests';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
let routeToday = '2026-12-01';
vi.mock('@/server/today', () => ({ todayIso: () => routeToday }));

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});

const now = new Date('2026-12-01T06:00:00.000Z');
const contacts: ReminderContacts = async () => ({ email: 'aino@example.com' });
const pass = (today: string, options: { contacts: ReminderContacts } = { contacts }) =>
  runWaitingListFollowUp(db, today, now, options);

async function addEntry(overrides: Record<string, unknown> = {}) {
  return db.waitingListEntry.create({
    data: {
      id: 'wait-aino',
      participantId: 'cust-aino',
      category: 'e_bike',
      maxMonthlyNetRentCents: 9_000,
      minCondition: 'good',
      preferredTermMonths: 24,
      neededBy: '2026-11-30',
      signedUpOn: '2026-11-01',
      who: 'A Lease Loop customer',
      locale: 'fi',
      ...overrides,
    },
  });
}

beforeEach(async () => {
  await db.waitingListEntry.deleteMany();
  await db.returnIntake.deleteMany();
  await clearReminderData(db);
  await seedDemoParticipants(db);
  routeToday = '2026-12-01';
});

describe('asking "Do you still want this?"', () => {
  it('waits through the needed-by day and asks once, the day after', async () => {
    await addEntry();
    expect(await pass('2026-11-30')).toEqual({ asked: 0, expired: 0, failed: 0 });
    expect(await pass('2026-12-01')).toEqual({ asked: 1, expired: 0, failed: 0 });
    expect(await pass('2026-12-02')).toEqual({ asked: 0, expired: 0, failed: 0 });

    const entry = await db.waitingListEntry.findUniqueOrThrow({ where: { id: 'wait-aino' } });
    expect(entry).toMatchObject({ status: 'waiting', stillWantedAskedOn: '2026-12-01' });
    expect(await db.auditLog.count({ where: { action: 'waiting_list.still_wanted_asked' } })).toBe(
      1
    );
  });

  it('lands in the existing inbox with an in-app and a simulated email delivery', async () => {
    await addEntry();
    await pass('2026-12-01');
    const inbox = await listInbox(db, 'cust-aino', now);
    expect(inbox.unreadCount).toBe(1);
    const [item] = inbox.items;
    expect(item).toMatchObject({
      kind: STILL_WANTED_KIND,
      contractId: null,
      endOn: '2026-11-30',
      locale: 'fi',
      payload: { actionPath: '/fi/waiting-list/wait-aino' },
    });
    // The window closes when 16 Dec starts in Helsinki.
    expect(item!.deadlineAt).toBe('2026-12-15T22:00:00.000Z');
    const detail = await getNotification(db, item!.id, 'cust-aino', now);
    expect(detail.deliveries.map((d) => [d.channel, d.mode, d.status])).toEqual([
      ['email', 'simulated', 'recorded'],
      ['in_app', 'simulated', 'recorded'],
    ]);
    expect(detail.deliveries[0]!.toAddress).toBe('aino@example.com');
    expect(detail.deliveries[0]!.bodyText).toContain('/fi/waiting-list/wait-aino');
    expect(await listInbox(db, 'cust-lena', now)).toMatchObject({ unreadCount: 0, items: [] });
  });

  it('skips only the email when the customer has no address', async () => {
    await addEntry();
    await pass('2026-12-01', { contacts: async () => ({ email: null }) });
    const notification = await db.notification.findFirstOrThrow({ include: { deliveries: true } });
    expect(notification.deliveries.map((d) => [d.channel, d.status]).sort()).toEqual([
      ['email', 'skipped_missing_contact'],
      ['in_app', 'recorded'],
    ]);
  });

  it('leaves data-pack entries and entries that are not waiting alone', async () => {
    await addEntry({ id: 'wait-pack', participantId: null });
    await addEntry({ id: 'wait-offered', status: 'offered' });
    await addEntry({ id: 'wait-gone', status: 'expired' });
    expect(await pass('2027-01-01')).toEqual({ asked: 0, expired: 0, failed: 0 });
    expect(await db.notification.count()).toBe(0);
  });

  it('records a failure for one entry and still handles the others', async () => {
    await addEntry({ id: 'wait-a' });
    await addEntry({ id: 'wait-b' });
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw new Error('contact lookup down');
      return { email: null };
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await pass('2026-12-01', { contacts: flaky })).toEqual({
      asked: 1,
      expired: 0,
      failed: 1,
    });
    error.mockRestore();
    // The failed one is asked on the next pass.
    expect(await pass('2026-12-02')).toEqual({ asked: 1, expired: 0, failed: 0 });
  });
});

describe('no reply', () => {
  it('keeps the entry through day 14 and expires it on day 15', async () => {
    await addEntry({ stillWantedAskedOn: '2026-12-01' });
    expect(await pass('2026-12-15')).toEqual({ asked: 0, expired: 0, failed: 0 });
    expect(await pass('2026-12-16')).toEqual({ asked: 0, expired: 1, failed: 0 });
    expect(
      await db.waitingListEntry.findUniqueOrThrow({ where: { id: 'wait-aino' } })
    ).toMatchObject({ status: 'expired', expiredOn: '2026-12-16', expiredReason: 'no_reply' });
    expect(await db.auditLog.count({ where: { action: 'waiting_list.expired' } })).toBe(1);
  });
});

describe('answering', () => {
  it('"yes" with a future date keeps the place and asks again once that date passes', async () => {
    await addEntry();
    await pass('2026-12-01');
    const kept = await answerStillWanted(
      db,
      'cust-aino',
      'wait-aino',
      { answer: 'yes', neededBy: '2027-01-10' },
      '2026-12-03'
    );
    expect(kept).toMatchObject({
      status: 'waiting',
      neededBy: '2027-01-10',
      stillWantedAskedOn: null,
      signedUpOn: '2026-11-01',
    });
    expect(await pass('2027-01-10')).toMatchObject({ asked: 0 });
    expect(await pass('2027-01-11')).toMatchObject({ asked: 1 });
    expect(await db.notification.count()).toBe(2);
  });

  it('"yes" needs a date strictly after today (checked on the server)', async () => {
    await addEntry({ stillWantedAskedOn: '2026-12-01' });
    for (const neededBy of ['2026-12-03', '2026-12-02'])
      await expect(
        answerStillWanted(db, 'cust-aino', 'wait-aino', { answer: 'yes', neededBy }, '2026-12-03')
      ).rejects.toMatchObject({ status: 422, code: 'INVALID_NEEDED_BY' });
  });

  it('"no" expires the entry at once', async () => {
    await addEntry({ stillWantedAskedOn: '2026-12-01' });
    const gone = await answerStillWanted(
      db,
      'cust-aino',
      'wait-aino',
      { answer: 'no' },
      '2026-12-02'
    );
    expect(gone).toMatchObject({
      status: 'expired',
      expiredOn: '2026-12-02',
      expiredReason: 'declined',
    });
    expect(await db.auditLog.count({ where: { action: 'waiting_list.declined' } })).toBe(1);
  });

  it('is refused before needed-by passes, after the window closes, and for others', async () => {
    await addEntry({ neededBy: '2026-12-05' });
    await expect(
      answerStillWanted(db, 'cust-aino', 'wait-aino', { answer: 'no' }, '2026-12-05')
    ).rejects.toMatchObject({ status: 409, code: 'NOT_ASKED' });
    await expect(
      answerStillWanted(db, 'cust-lena', 'wait-aino', { answer: 'no' }, '2026-12-06')
    ).rejects.toMatchObject({ status: 404 });
    await db.waitingListEntry.update({
      where: { id: 'wait-aino' },
      data: { stillWantedAskedOn: '2026-12-06' },
    });
    await expect(
      answerStillWanted(db, 'cust-aino', 'wait-aino', { answer: 'no' }, '2026-12-21')
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('POST /api/waiting-list/:id/still-wanted', () => {
  const answer = (name: string | null, body: unknown) =>
    POST(
      new Request('http://localhost/api/waiting-list/wait-aino/still-wanted', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(name ? { cookie: demoNameCookieHeader(name) } : {}),
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: 'wait-aino' }) }
    );

  it('saves a new date for the signed-in owner and rejects today', async () => {
    await addEntry({ stillWantedAskedOn: '2026-12-01' });
    expect((await answer(null, { answer: 'no' })).status).toBe(401);
    const today = await answer('aino', { answer: 'yes', neededBy: '2026-12-01' });
    expect(today.status).toBe(422);
    expect(await today.json()).toMatchObject({
      success: false,
      error: { code: 'INVALID_NEEDED_BY', details: ['not_in_future'] },
    });
    const later = await answer('aino', { answer: 'yes', neededBy: '2027-02-01' });
    expect(later.status).toBe(200);
    expect(await later.json()).toMatchObject({ success: true, data: { neededBy: '2027-02-01' } });
  });
});

describe('expected receiving date', () => {
  it('is the later of today and the offered item’s lease end; none without a match', async () => {
    await seedLease(db, { id: 'c-old', endOn: '2026-12-20', savedAt: now, assetId: 'ebike-001' });
    await db.returnIntake.create({
      data: {
        id: 'ri-1',
        assetId: 'ebike-001',
        contractId: 'c-old',
        providerId: 'p',
        source: 'receipt',
      },
    });
    await addEntry({
      id: 'wait-offered',
      status: 'offered',
      offeredAssetId: 'ebike-001',
      offeredIntakeId: 'ri-1',
      neededBy: '2027-01-31',
    });
    await addEntry({ id: 'wait-open', neededBy: '2027-01-31' });

    const mine = await myWaitingList(db, 'cust-aino', '2026-12-01');
    const byId = new Map(mine.map((entry) => [entry.id, entry]));
    expect(byId.get('wait-offered')!.expectedFrom).toBe('2026-12-20');
    expect(byId.get('wait-open')!.expectedFrom).toBeNull();
    expect((await myWaitingList(db, 'cust-aino', '2026-12-28'))[0]!.expectedFrom).toBe(
      '2026-12-28'
    );
    expect(await myWaitingListEntry(db, 'cust-lena', 'wait-open', '2026-12-01')).toBeNull();
  });

  it('shows the last day to answer on an asked entry', async () => {
    await addEntry({ stillWantedAskedOn: '2026-12-01' });
    expect(await myWaitingListEntry(db, 'cust-aino', 'wait-aino', '2026-12-02')).toMatchObject({
      replyBy: '2026-12-15',
    });
  });
});

describe('renderStillWantedEmail', () => {
  it('writes the question in the customer’s language with the answer link', () => {
    const email = renderStillWantedEmail(
      'en',
      { category: 'laptop', neededBy: '2026-11-30' },
      '2026-12-15',
      '/en/waiting-list/w1'
    );
    expect(email.subject).toBe('Do you still want a used laptop?');
    expect(email.text).toContain('/en/waiting-list/w1');
    expect(email.text).toContain('Nothing was sent outside Lease Loop');
  });
});
