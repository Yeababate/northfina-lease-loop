import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearReminderData, seedLease } from '../../../tests/helpers/reminders';
import { createTestDb } from '../../../tests/helpers/test-db';
import type { PrismaClient } from '../prisma-client';
import {
  getNotification,
  listInbox,
  markAllNotificationsRead,
  markNotificationRead,
} from './inbox';
import { runReminderPass } from './processor';

let db: PrismaClient;
let cleanup: () => Promise<void>;
const savedAt = new Date('2026-11-01T10:00:00.000Z');
const contacts = async () => ({ email: 'someone@example.com' });

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await clearReminderData(db);
  await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
  await seedLease(db, { id: 'c2', endOn: '2026-12-06', savedAt });
  await seedLease(db, { id: 'c3', endOn: '2026-12-05', savedAt, recipientId: 'cust-lena' });
  // Generated while nobody is logged in.
  await runReminderPass(db, new Date('2026-11-06T08:00:00.000Z'), { contacts });
});

describe('inbox', () => {
  it('lists only the recipient’s notifications and does not mark them read', async () => {
    const later = new Date('2026-12-02T08:00:00.000Z');
    const inbox = await listInbox(db, 'cust-aino', later);
    expect(inbox.unreadCount).toBe(2);
    expect(inbox.items.map((i) => i.contractId).sort()).toEqual(['c1', 'c2']);
    const c1 = inbox.items.find((i) => i.contractId === 'c1')!;
    // Saved timing is history; the timing shown is computed when viewed.
    expect(c1.timingAtGeneration).toEqual({ kind: 'days', days: 29 });
    expect(c1.timingNow).toEqual({ kind: 'days', days: 3 });
    expect(c1.readAt).toBeNull();
    expect((await listInbox(db, 'cust-aino', later)).unreadCount).toBe(2);
    expect((await listInbox(db, 'cust-lena', later)).items).toHaveLength(1);
  });

  it('opens a notification with its simulated email preview, for its owner only', async () => {
    const [item] = (await listInbox(db, 'cust-lena', savedAt)).items;
    const now = new Date('2026-11-07T00:00:00.000Z');
    const detail = await getNotification(db, item!.id, 'cust-lena', now);
    expect(detail.deliveries.map((d) => [d.channel, d.mode, d.status])).toEqual([
      ['email', 'simulated', 'recorded'],
      ['in_app', 'simulated', 'recorded'],
    ]);
    expect(detail.deliveries[0]!.subject).toContain('ends soon');
    await expect(getNotification(db, item!.id, 'cust-aino', now)).rejects.toMatchObject({
      status: 404,
      code: 'NOTIFICATION_NOT_FOUND',
    });
    await expect(markNotificationRead(db, item!.id, 'cust-aino', now)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('marks one read once, with an audit row, and survives a later pass', async () => {
    const [item] = (await listInbox(db, 'cust-lena', savedAt)).items;
    const now = new Date('2026-11-07T00:00:00.000Z');
    expect(await markNotificationRead(db, item!.id, 'cust-lena', now)).toEqual({
      id: item!.id,
      readAt: now.toISOString(),
    });
    const again = await markNotificationRead(db, item!.id, 'cust-lena', new Date('2026-11-08'));
    expect(again.readAt).toBe(now.toISOString());
    expect(await db.auditLog.count({ where: { action: 'notification.read' } })).toBe(1);
    await runReminderPass(db, new Date('2026-11-07T00:01:00.000Z'), { contacts });
    expect((await listInbox(db, 'cust-lena', now)).unreadCount).toBe(0);
  });

  it('marks all read for one recipient only', async () => {
    const now = new Date('2026-11-07T00:00:00.000Z');
    expect(await markAllNotificationsRead(db, 'cust-aino', now)).toEqual({ marked: 2 });
    expect((await listInbox(db, 'cust-aino', now)).unreadCount).toBe(0);
    expect((await listInbox(db, 'cust-lena', now)).unreadCount).toBe(1);
  });
});
