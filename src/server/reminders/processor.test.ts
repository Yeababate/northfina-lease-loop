import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAssets } from '@/data/load';
import { clearReminderData, seedLease } from '../../../tests/helpers/reminders';
import { createTestDb } from '../../../tests/helpers/test-db';
import { seedAssets } from '../assets';
import type { PrismaClient } from '../prisma-client';
import { runReminderPass, type PassOptions } from './processor';

let db: PrismaClient;
let cleanup: () => Promise<void>;
const options: PassOptions = { contacts: async () => ({ email: 'aino.virtanen@example.com' }) };
const savedAt = new Date('2026-11-01T10:00:00.000Z');
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  await seedAssets(db, await loadAssets());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await clearReminderData(db);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const statuses = async (contractId = 'c1') =>
  (await db.reminderOccurrence.findMany({ where: { contractId }, orderBy: { dueAt: 'asc' } })).map(
    (o) => [o.ruleId, o.status]
  );

describe('runReminderPass', () => {
  it('uses only in-app delivery when requested and falls back to English for an old unsupported locale', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    const pref = await db.reminderPreference.findFirstOrThrow();
    const rules = (JSON.parse(pref.rulesJson) as { channels: string[] }[]).map((rule) => ({
      ...rule,
      channels: ['in_app'],
    }));
    await db.reminderPreference.update({
      where: { id: pref.id },
      data: { locale: 'unknown', rulesJson: JSON.stringify(rules) },
    });
    await db.reminderOccurrence.updateMany({ data: { channelsJson: '["in_app"]' } });
    const contacts = vi.fn(options.contacts);
    expect(await runReminderPass(db, at('2026-11-05T08:00:00Z'), { contacts })).toMatchObject({
      notified: 1,
    });
    expect(contacts).not.toHaveBeenCalled();
    expect(await db.notification.findFirst()).toMatchObject({ locale: 'en' });
    expect(await db.notificationDelivery.findMany()).toMatchObject([
      { channel: 'in_app', status: 'recorded' },
    ]);
  });

  it('cancels orphaned occurrences when their preference row has been removed', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    await db.reminderPreference.deleteMany();
    expect(await runReminderPass(db, at('2026-11-05T08:00:00Z'), options)).toMatchObject({
      notified: 0,
      cancelled: 1,
    });
    expect(await db.notification.count()).toBe(0);
  });

  it('rolls back notification artifacts when the occurrence claim is lost at commit', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    const racing = db.$extends({
      query: {
        reminderOccurrence: {
          async updateMany({ args, query }) {
            return args.data.status === 'covered' ? { count: 0 } : query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
    expect(await runReminderPass(racing, at('2026-11-05T08:00:00Z'), options)).toMatchObject({
      notified: 0,
      failed: 1,
    });
    expect(await db.notification.count()).toBe(0);
    expect(await db.reminderCoverage.count()).toBe(0);
    expect(await db.reminderOccurrence.findFirst({ where: { ruleId: 'd30' } })).toMatchObject({
      status: 'pending',
      lastErrorCode: 'DELIVERY_FAILED',
      attempts: 1,
    });
  });

  it('does not crash the pass if recording a delivery failure also fails', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    const failing = db.$extends({
      query: {
        auditLog: {
          async create({ args, query }) {
            if (args.data.action === 'reminder.attempt_failed')
              throw new Error('audit unavailable');
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
    expect(
      await runReminderPass(failing, at('2026-11-05T08:00:00Z'), {
        contacts: async () => {
          throw new Error('contacts unavailable');
        },
      })
    ).toMatchObject({ notified: 0, failed: 1 });
    expect(console.error).toHaveBeenCalledWith(
      'Could not record the reminder failure:',
      expect.any(Error)
    );
    expect(await db.notification.count()).toBe(0);
  });
  it('does nothing before the first reminder is due', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    expect(await runReminderPass(db, at('2026-11-05T06:59:59.000Z'), options)).toEqual({
      notified: 0,
      covered: 0,
      cancelled: 0,
      failed: 0,
    });
    expect(await db.notification.count()).toBe(0);
  });

  it('delivers an on-time reminder to a logged-out recipient, once', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    const summary = await runReminderPass(db, at('2026-11-05T07:00:20.000Z'), options);
    expect(summary).toMatchObject({ notified: 1, covered: 1 });
    const notification = await db.notification.findFirstOrThrow({
      include: { deliveries: { orderBy: { channel: 'asc' } }, receipt: true, coverages: true },
    });
    expect(notification).toMatchObject({
      recipientId: 'cust-aino',
      contractId: 'c1',
      catchUp: false,
      endOn: '2026-12-05',
    });
    expect(JSON.parse(notification.timingJson)).toEqual({ kind: 'days', days: 30 });
    expect(JSON.parse(notification.payloadJson)).toEqual({
      itemName: 'Nordvolt Trail 500',
      assetId: 'ebike-003',
      actionPath: '/en/contracts/c1',
    });
    expect(notification.receipt?.readAt).toBeNull();
    expect(notification.coverages.map((c) => c.channel).sort()).toEqual(['email', 'in_app']);
    const [email, inApp] = notification.deliveries;
    expect(inApp).toMatchObject({ channel: 'in_app', mode: 'simulated', status: 'recorded' });
    expect(email).toMatchObject({
      channel: 'email',
      mode: 'simulated',
      status: 'recorded',
      toAddress: 'aino.virtanen@example.com',
      subject: 'Your lease of Nordvolt Trail 500 ends soon',
    });
    expect(email!.bodyText).toContain('30 days left');
    expect(await statuses()).toEqual([
      ['d30', 'covered'],
      ['d7', 'pending'],
      ['d1', 'pending'],
    ]);
    expect(await db.auditLog.count({ where: { action: 'notification.created' } })).toBe(1);

    await runReminderPass(db, at('2026-11-05T07:00:50.000Z'), options);
    expect(await db.notification.count()).toBe(1);
  });

  it('coalesces reminders missed during downtime into one current catch-up', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    // Server down from before 5 Nov until 1 Dec: the 30- and 7-day reminders were missed.
    const restart = at('2026-12-01T12:00:00.000Z');
    expect(await runReminderPass(db, restart, options)).toMatchObject({ notified: 1, covered: 2 });
    const notification = await db.notification.findFirstOrThrow({ include: { deliveries: true } });
    expect(notification.catchUp).toBe(true);
    expect(notification.originalDueAt.toISOString()).toBe('2026-11-05T07:00:00.000Z');
    expect(JSON.parse(notification.timingJson)).toEqual({ kind: 'days', days: 4 });
    const email = notification.deliveries.find((d) => d.channel === 'email')!;
    expect(email.bodyText).toContain('4 days left');
    expect(email.bodyText).toContain('sent late');
    expect(email.bodyText).not.toContain('30 days');
    expect(await statuses()).toEqual([
      ['d30', 'covered'],
      ['d7', 'covered'],
      ['d1', 'pending'],
    ]);
    // Another restart sends nothing for the covered pair; the 1-day reminder still comes.
    await runReminderPass(db, at('2026-12-01T12:05:00.000Z'), options);
    expect(await db.notification.count()).toBe(1);
    await runReminderPass(db, at('2026-12-04T07:00:00.000Z'), options);
    expect(await db.notification.count()).toBe(2);
  });

  it('uses ended wording when the backlog is processed after the deadline', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt, locale: 'fi' });
    await runReminderPass(db, at('2026-12-07T08:00:00.000Z'), options);
    const notification = await db.notification.findFirstOrThrow({ include: { deliveries: true } });
    expect(JSON.parse(notification.timingJson)).toEqual({ kind: 'ended', days: 2 });
    const email = notification.deliveries.find((d) => d.channel === 'email')!;
    expect(email.locale).toBe('fi');
    expect(email.subject).toBe('Kohteen Nordvolt Trail 500 leasing on päättynyt');
  });

  it('never creates duplicates when two workers run at the same time', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    const now = at('2026-11-29T00:00:00.000Z');
    await Promise.all([
      runReminderPass(db, now, options),
      runReminderPass(db, now, options),
      runReminderPass(db, now, options),
    ]);
    expect(await db.notification.count()).toBe(1);
    expect(await db.reminderCoverage.count()).toBe(4);
  });

  it('leaves a live claim alone and recovers an expired one', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    await db.reminderOccurrence.updateMany({
      where: { ruleId: 'd30' },
      data: { claimToken: 'crashed', claimedUntil: at('2026-11-05T07:02:00.000Z') },
    });
    await runReminderPass(db, at('2026-11-05T07:01:00.000Z'), options);
    expect(await db.notification.count()).toBe(0);
    await runReminderPass(db, at('2026-11-05T07:02:30.000Z'), options);
    expect(await db.notification.count()).toBe(1);
  });

  it('records a failed delivery for retry, rolls it back, and still serves other leases', async () => {
    await seedLease(db, { id: 'bad', endOn: '2026-12-05', savedAt });
    await seedLease(db, { id: 'good', endOn: '2026-12-06', savedAt });
    const failing = db.$extends({
      query: {
        notification: {
          create({ args, query }) {
            if (args.data.contractId === 'bad') throw new Error('disk full');
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
    const now = at('2026-11-06T08:00:00.000Z');
    expect(await runReminderPass(failing, now, options)).toMatchObject({
      notified: 1,
      failed: 1,
    });
    const bad = await db.reminderOccurrence.findFirstOrThrow({
      where: { contractId: 'bad', ruleId: 'd30' },
    });
    expect(bad).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastErrorCode: 'DELIVERY_FAILED',
      claimToken: null,
    });
    expect(bad.nextAttemptAt?.toISOString()).toBe('2026-11-06T08:00:30.000Z');
    expect(await db.notification.count({ where: { contractId: 'bad' } })).toBe(0);
    expect(await db.reminderCoverage.count({ where: { occurrenceId: bad.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: 'reminder.attempt_failed' } })).toBe(1);

    // Waiting for the backoff, then a healthy retry delivers it.
    await runReminderPass(db, at('2026-11-06T08:00:10.000Z'), options);
    expect(await db.notification.count({ where: { contractId: 'bad' } })).toBe(0);
    await runReminderPass(db, at('2026-11-06T08:00:30.000Z'), options);
    expect(await db.notification.count({ where: { contractId: 'bad' } })).toBe(1);
  });

  it('keeps in-app delivery when the recipient has no email address', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    await runReminderPass(db, at('2026-11-05T07:00:00.000Z'), {
      contacts: async () => ({ email: null }),
    });
    const deliveries = await db.notificationDelivery.findMany({ orderBy: { channel: 'asc' } });
    expect(deliveries.map((d) => [d.channel, d.status, d.subject])).toEqual([
      ['email', 'skipped_missing_contact', null],
      ['in_app', 'recorded', null],
    ]);
  });

  it('cancels reminders whose lease end changed instead of sending stale ones', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    await db.contract.update({ where: { id: 'c1' }, data: { endOn: '2027-01-05' } });
    expect(await runReminderPass(db, at('2026-11-06T00:00:00.000Z'), options)).toMatchObject({
      notified: 0,
      cancelled: 1,
    });
    expect((await statuses())[0]).toEqual(['d30', 'cancelled']);
  });

  it('serves leases in bounded batches', async () => {
    await seedLease(db, { id: 'c1', endOn: '2026-12-05', savedAt });
    await seedLease(db, { id: 'c2', endOn: '2026-12-05', savedAt });
    const now = at('2026-11-06T00:00:00.000Z');
    expect(await runReminderPass(db, now, { ...options, maxGroups: 1 })).toMatchObject({
      notified: 1,
    });
    expect(await runReminderPass(db, now, { ...options, maxGroups: 1 })).toMatchObject({
      notified: 1,
    });
    expect(await db.notification.count()).toBe(2);
  });
});
