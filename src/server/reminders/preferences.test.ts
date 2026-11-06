import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultReminderPreferences,
  type ReminderPreferences,
} from '@/domain/reminder-preferences';
import { clearReminderData, seedLease } from '../../../tests/helpers/reminders';
import { createTestDb } from '../../../tests/helpers/test-db';
import type { PrismaClient } from '../prisma-client';
import { getReminderSettings, updateReminderSettings, validateReminderSetup } from './preferences';
import { runReminderPass } from './processor';

let db: PrismaClient;
let cleanup: () => Promise<void>;
const savedAt = new Date('2026-11-01T10:00:00.000Z');
const editAt = new Date('2026-11-10T10:00:00.000Z');
const contacts = async () => ({ email: 'aino.virtanen@example.com' });
const base = defaultReminderPreferences('Europe/Helsinki');

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await clearReminderData(db);
});

const update = (
  preferences: ReminderPreferences,
  expectedRevision = 1,
  recipientId = 'cust-aino'
) =>
  updateReminderSettings(
    db,
    { contractId: 'c1', recipientId, expectedRevision, preferences },
    editAt
  );

describe('validateReminderSetup', () => {
  const event = { contractId: 'c1', recipientId: 'cust-aino', endOn: '2026-12-05' };
  it('returns the normalised settings and schedule', () => {
    expect(validateReminderSetup(event, base, savedAt).schedule.occurrences).toHaveLength(3);
  });
  it('rejects bad shapes and reminders after the lease end with 422', () => {
    expect(() => validateReminderSetup(event, { ...base, timeZone: 'Nowhere/X' }, savedAt)).toThrow(
      expect.objectContaining({ status: 422, code: 'INVALID_REMINDERS' })
    );
    const late = { ...base, rules: [{ ...base.rules[0]!, daysBefore: 0 }] };
    expect(() => validateReminderSetup(event, late, savedAt)).toThrow(
      expect.objectContaining({
        code: 'INVALID_REMINDERS',
        details: { problems: [{ ruleId: 'd30', reason: 'after_end' }] },
      })
    );
  });
});

describe('reminder settings', () => {
  it('reads only the recipient’s own settings with the saved schedule', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    const settings = await getReminderSettings(db, 'c1', 'cust-aino');
    expect(settings).toMatchObject({ revision: 1, locale: 'en', preferences: base });
    expect(settings.schedule.map((s) => [s.ruleId, s.localDate, s.localTime, s.status])).toEqual([
      ['d30', '2026-11-05', '09:00', 'pending'],
      ['d7', '2026-11-28', '09:00', 'pending'],
      ['d1', '2026-12-04', '09:00', 'pending'],
    ]);
    await expect(getReminderSettings(db, 'c1', 'cust-lena')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('moves a sent reminder’s clock time without sending it again', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    await runReminderPass(db, new Date('2026-11-05T07:00:00.000Z'), { contacts });
    const before = await db.reminderOccurrence.findMany({ orderBy: { dueAt: 'asc' } });
    const moved = { ...base, rules: base.rules.map((r) => ({ ...r, time: '18:30' })) };
    const settings = await update(moved);
    expect(settings.revision).toBe(2);
    expect(settings.schedule.map((s) => [s.ruleId, s.localTime, s.status])).toEqual([
      ['d30', '09:00', 'covered'],
      ['d7', '18:30', 'pending'],
      ['d1', '18:30', 'pending'],
    ]);
    const after = await db.reminderOccurrence.findMany({ orderBy: { dueAt: 'asc' } });
    expect(after.map((o) => o.id)).toEqual(before.map((o) => o.id));
    await runReminderPass(db, new Date('2026-11-10T11:00:00.000Z'), { contacts });
    expect(await db.notification.count()).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'reminder_preferences.updated' },
    });
    expect(audit).toMatchObject({ actor: 'cust-aino', entity_id: 'c1' });
  });

  it('adds, removes, re-times and switches off only unsent reminders', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    const edited: ReminderPreferences = {
      enabled: true,
      timeZone: 'Europe/Tallinn',
      rules: [
        { id: 'd30', daysBefore: 30, time: '09:00', channels: ['email'], enabled: true },
        { id: 'd7', daysBefore: 6, time: '09:00', channels: ['in_app'], enabled: true },
        { id: 'r1', daysBefore: 14, time: '12:00', channels: ['in_app', 'email'], enabled: true },
      ],
    };
    const settings = await update(edited);
    expect(settings.schedule.map((s) => [s.ruleId, s.daysBefore, s.status])).toEqual([
      // Already past when saved: shown, but not sent late.
      ['d30', 30, 'skipped_past'],
      ['r1', 14, 'pending'],
      ['d7', 7, 'cancelled'],
      ['d7', 6, 'pending'],
      ['d1', 1, 'cancelled'],
    ]);
    const off = await update({ ...edited, enabled: false }, 2);
    expect(off.schedule.filter((s) => s.status === 'pending')).toEqual([]);
    const on = await update(edited, 3);
    expect(on.schedule.filter((s) => s.status === 'pending').map((s) => s.ruleId)).toEqual([
      'r1',
      'd7',
    ]);
  });

  it('rejects a stale revision, another user’s lease and invalid settings', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    await update(base);
    await expect(update(base, 1)).rejects.toMatchObject({ status: 409, code: 'REMINDERS_CHANGED' });
    await expect(update(base, 2, 'cust-lena')).rejects.toMatchObject({ status: 404 });
    await expect(
      update({ ...base, rules: [{ ...base.rules[0]!, channels: [] }] }, 2)
    ).rejects.toMatchObject({
      status: 422,
    });
    expect((await getReminderSettings(db, 'c1', 'cust-aino')).revision).toBe(2);
  });

  it('rolls everything back when the audit row cannot be written', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    const failing = db.$extends({
      query: {
        auditLog: {
          create() {
            throw new Error('audit unavailable');
          },
        },
      },
    }) as unknown as PrismaClient;
    await expect(
      updateReminderSettings(
        failing,
        {
          contractId: 'c1',
          recipientId: 'cust-aino',
          expectedRevision: 1,
          preferences: { ...base, enabled: false },
        },
        editAt
      )
    ).rejects.toThrow('audit unavailable');
    const settings = await getReminderSettings(db, 'c1', 'cust-aino');
    expect(settings.revision).toBe(1);
    expect(settings.schedule.every((s) => s.status === 'pending')).toBe(true);
  });
});
