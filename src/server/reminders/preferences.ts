// Per-lease reminder preferences: saving them (at signing and later), and keeping the
// saved reminder occurrences in step with them. Business rules live in src/domain;
// this module reads and writes the database, always inside withAudit's transaction.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isClockTime } from '@/domain/local-time';
import {
  checkPreferences,
  REMINDER_CHANNELS,
  MAX_DAYS_BEFORE,
  MAX_REMINDER_RULES,
  type ReminderPreferences,
} from '@/domain/reminder-preferences';
import { planSchedule, type LeaseEvent, type Schedule } from '@/domain/reminder-schedule';
import { reconcileOccurrences, type OccurrenceStatus } from '@/domain/reminder-reconcile';
import { locales, type Locale } from '@/i18n/locales';
import { ApiError } from '../api-response';
import { withAudit, type TransactionClient } from '../audit';
import type { PrismaClient } from '../prisma-client';

export const reminderRuleSchema = z.strictObject({
  id: z.string().min(1).max(40),
  daysBefore: z.number().int().min(0).max(MAX_DAYS_BEFORE),
  time: z.string().refine(isClockTime, 'Expected HH:MM'),
  channels: z.array(z.enum(REMINDER_CHANNELS)).max(REMINDER_CHANNELS.length),
  enabled: z.boolean(),
});

export const reminderPreferencesSchema = z.strictObject({
  enabled: z.boolean(),
  timeZone: z.string().min(1).max(64),
  rules: z.array(reminderRuleSchema).max(MAX_REMINDER_RULES),
});

export const reminderLocaleSchema = z.enum(locales);

const savedRulesSchema = z.array(reminderRuleSchema);

/**
 * Validates settings against the domain rules and the lease's actual end. Throws a 422
 * listing every problem, so a client can point at the rule that needs fixing.
 */
export function validateReminderSetup(
  event: LeaseEvent,
  input: ReminderPreferences,
  now: Date
): { preferences: ReminderPreferences; schedule: Schedule } {
  const checked = checkPreferences(input);
  if (!checked.ok)
    throw new ApiError(422, 'INVALID_REMINDERS', 'The reminder settings are not valid', {
      problems: checked.problems,
    });
  const schedule = planSchedule(event, checked.preferences, now.toISOString());
  if (schedule.problems.length > 0)
    throw new ApiError(422, 'INVALID_REMINDERS', 'The reminder settings are not valid', {
      problems: schedule.problems,
    });
  return { preferences: checked.preferences, schedule };
}

/** Creates, moves or cancels occurrences so they match `schedule`. Uses only `tx`. */
async function applySchedule(
  tx: TransactionClient,
  event: LeaseEvent,
  schedule: Schedule,
  revision: number
) {
  const saved = await tx.reminderOccurrence.findMany({
    where: { contractId: event.contractId, recipientId: event.recipientId },
  });
  const actions = reconcileOccurrences(
    saved.map((row) => ({
      id: row.id,
      key: row.logicalKey,
      status: row.status as OccurrenceStatus,
    })),
    schedule.occurrences
  );
  const fields = (planned: Schedule['occurrences'][number], status: string) => ({
    eventVersion: schedule.eventVersion,
    deadlineAt: new Date(schedule.deadlineAt),
    dueAt: new Date(planned.dueAt),
    localDate: planned.localDate,
    localTime: planned.localTime,
    timeZone: planned.timeZone,
    channelsJson: JSON.stringify(planned.channels),
    preferenceRevision: revision,
    status,
    // A moved reminder starts fresh: no claim, no pending retry.
    claimToken: null,
    claimedUntil: null,
    nextAttemptAt: null,
  });
  const summary = { created: 0, updated: 0, cancelled: 0 };
  for (const action of actions) {
    if (action.kind === 'create') {
      await tx.reminderOccurrence.create({
        data: {
          id: randomUUID(),
          logicalKey: action.planned.key,
          contractId: event.contractId,
          recipientId: event.recipientId,
          ruleId: action.planned.ruleId,
          daysBefore: action.planned.daysBefore,
          ...fields(action.planned, action.status),
        },
      });
      summary.created += 1;
    } else if (action.kind === 'update') {
      await tx.reminderOccurrence.updateMany({
        where: { id: action.id, status: { not: 'covered' } },
        data: fields(action.planned, action.status),
      });
      summary.updated += 1;
    } else if (action.kind === 'cancel') {
      await tx.reminderOccurrence.updateMany({
        where: { id: action.id, status: 'pending' },
        data: { status: 'cancelled', claimToken: null, claimedUntil: null },
      });
      summary.cancelled += 1;
    }
  }
  return summary;
}

export type InitialReminders = {
  recipientId: string;
  locale: Locale;
  preferences: ReminderPreferences;
};

/**
 * Saves the first preferences of a newly signed lease. Call it with the signing
 * transaction's `tx`, after validateReminderSetup, so the contract, its preferences and
 * the audit row commit together or not at all.
 */
export async function createReminderPreferencesInTx(
  tx: TransactionClient,
  event: LeaseEvent,
  initial: InitialReminders,
  schedule: Schedule
) {
  const preference = await tx.reminderPreference.create({
    data: {
      id: randomUUID(),
      contractId: event.contractId,
      recipientId: initial.recipientId,
      enabled: initial.preferences.enabled,
      timeZone: initial.preferences.timeZone,
      locale: initial.locale,
      rulesJson: JSON.stringify(initial.preferences.rules),
      revision: 1,
    },
  });
  await applySchedule(tx, event, schedule, preference.revision);
  return preference;
}

type PreferenceRow = {
  id: string;
  contractId: string;
  recipientId: string;
  enabled: boolean;
  timeZone: string;
  locale: string;
  rulesJson: string;
  revision: number;
};

export function preferencesFromRow(row: PreferenceRow): ReminderPreferences {
  return {
    enabled: row.enabled,
    timeZone: row.timeZone,
    rules: savedRulesSchema.parse(JSON.parse(row.rulesJson)),
  };
}

/** The recipient's own preferences and the saved schedule for one lease, or 404. */
export async function getReminderSettings(
  db: PrismaClient,
  contractId: string,
  recipientId: string
) {
  const row = await db.reminderPreference.findUnique({
    where: { contractId_recipientId: { contractId, recipientId } },
  });
  if (!row) throw new ApiError(404, 'REMINDERS_NOT_FOUND', 'No reminder settings for this lease');
  const occurrences = await db.reminderOccurrence.findMany({
    where: { contractId, recipientId },
    orderBy: { dueAt: 'asc' },
  });
  return {
    contractId,
    revision: row.revision,
    locale: row.locale,
    preferences: preferencesFromRow(row),
    schedule: occurrences.map((o) => ({
      ruleId: o.ruleId,
      daysBefore: o.daysBefore,
      localDate: o.localDate,
      localTime: o.localTime,
      timeZone: o.timeZone,
      dueAt: o.dueAt.toISOString(),
      eventVersion: o.eventVersion,
      channels: JSON.parse(o.channelsJson) as string[],
      /** pending | covered | cancelled | skipped_past (already past when saved). */
      status: o.status,
      attempts: o.attempts,
      lastErrorCode: o.lastErrorCode,
    })),
  };
}

export type UpdateRemindersInput = {
  contractId: string;
  recipientId: string;
  expectedRevision: number;
  preferences: ReminderPreferences;
  locale?: Locale;
};

/**
 * Saves edited preferences. Only the recipient's own row can be found (another user
 * gets 404), a stale revision gets 409, and only future, undelivered reminders change.
 */
export async function updateReminderSettings(
  db: PrismaClient,
  input: UpdateRemindersInput,
  now: Date
) {
  const where = {
    contractId_recipientId: { contractId: input.contractId, recipientId: input.recipientId },
  };
  const existing = await db.reminderPreference.findUnique({ where });
  const contract = await db.contract.findUnique({ where: { id: input.contractId } });
  if (!existing || !contract)
    throw new ApiError(404, 'REMINDERS_NOT_FOUND', 'No reminder settings for this lease');
  const event = { contractId: contract.id, recipientId: input.recipientId, endOn: contract.endOn };
  const { preferences, schedule } = validateReminderSetup(event, input.preferences, now);
  await withAudit(
    db,
    {
      actor: input.recipientId,
      action: 'reminder_preferences.updated',
      entityType: 'contract',
      entityId: contract.id,
      details: { fromRevision: input.expectedRevision, preferences },
    },
    async (tx) => {
      const saved = await tx.reminderPreference.updateMany({
        where: { id: existing.id, revision: input.expectedRevision },
        data: {
          enabled: preferences.enabled,
          timeZone: preferences.timeZone,
          rulesJson: JSON.stringify(preferences.rules),
          revision: { increment: 1 },
          ...(input.locale ? { locale: input.locale } : {}),
        },
      });
      if (saved.count !== 1)
        throw new ApiError(409, 'REMINDERS_CHANGED', 'The settings changed. Reload and try again');
      return applySchedule(tx, event, schedule, input.expectedRevision + 1);
    }
  );
  return getReminderSettings(db, input.contractId, input.recipientId);
}

/** Reconcile every recipient's schedule in the audited final-signature transaction. */
export async function rescheduleRemindersInTx(
  tx: TransactionClient,
  contractId: string,
  endOn: string,
  now: Date
) {
  const rows = await tx.reminderPreference.findMany({ where: { contractId } });
  for (const row of rows) {
    const event = { contractId, recipientId: row.recipientId, endOn };
    const { schedule } = validateReminderSetup(event, preferencesFromRow(row), now);
    await applySchedule(tx, event, schedule, row.revision);
  }
}
