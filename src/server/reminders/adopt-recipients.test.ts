import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearReminderData, seedLease } from '../../../tests/helpers/reminders';
import { createTestDb } from '../../../tests/helpers/test-db';
import { seedDemoParticipants } from '../demo-participants';
import type { PrismaClient } from '../prisma-client';
import { adoptNamedReminderRecipients } from './adopt-recipients';
import { getReminderSettings } from './preferences';
import { runReminderPass } from './processor';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await clearReminderData(db);
  await seedDemoParticipants(db); // includes "aino" → cust-aino
});

const savedAt = new Date('2026-11-01');

describe('adoptNamedReminderRecipients', () => {
  it('leaves invalid legacy names untouched without writing an adoption audit', async () => {
    await seedLease(db, { id: 'invalid', endOn: '2030-12-05', recipientId: '   ', savedAt });
    expect(await adoptNamedReminderRecipients(db)).toBe(0);
    expect(await db.reminderPreference.count({ where: { recipientId: '   ' } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'reminder.recipient_adopted' } })).toBe(0);
  });
  it('moves reminders saved under a typed name to that person’s id, whatever the capitals', async () => {
    await seedLease(db, { id: 'c1', endOn: '2030-12-05', recipientId: '  AINO ', savedAt });
    // A due reminder, so a notification exists under the old name too.
    await runReminderPass(db, new Date('2030-11-05T07:00:00.000Z'), {
      contacts: async () => ({ email: null }),
    });
    expect(await db.notification.count({ where: { recipientId: '  AINO ' } })).toBe(1);

    expect(await adoptNamedReminderRecipients(db)).toBe(1);
    const settings = await getReminderSettings(db, 'c1', 'cust-aino');
    expect(settings.schedule.length).toBeGreaterThan(0);
    expect(await db.notification.count({ where: { recipientId: 'cust-aino' } })).toBe(1);
    expect(await db.notificationReceipt.count({ where: { recipientId: 'cust-aino' } })).toBe(1);
    expect(await db.reminderOccurrence.count({ where: { recipientId: '  AINO ' } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: 'reminder.recipient_adopted' } })).toBe(1);
  });

  it('is safe to run again and leaves names that match nobody alone', async () => {
    await seedLease(db, { id: 'c1', endOn: '2030-12-05', recipientId: 'Aino', savedAt });
    await seedLease(db, {
      id: 'c2',
      endOn: '2030-12-05',
      recipientId: 'Nobody Known',
      savedAt,
      assetId: 'ebike-004',
    });
    await adoptNamedReminderRecipients(db);
    expect(await adoptNamedReminderRecipients(db)).toBe(0);
    expect(await db.reminderPreference.count({ where: { recipientId: 'Nobody Known' } })).toBe(1);
  });

  it('never overwrites settings a lease already has under the id', async () => {
    await seedLease(db, { id: 'c1', endOn: '2030-12-05', recipientId: 'cust-aino', savedAt });
    await db.reminderPreference.create({
      data: {
        id: 'legacy-pref',
        contractId: 'c1',
        recipientId: 'Aino',
        enabled: false,
        timeZone: 'Europe/Helsinki',
        locale: 'en',
        rulesJson: '[]',
      },
    });
    await adoptNamedReminderRecipients(db);
    const prefs = await db.reminderPreference.findMany({ where: { contractId: 'c1' } });
    expect(prefs.map((p) => p.recipientId).sort()).toEqual(['Aino', 'cust-aino']);
  });
});
