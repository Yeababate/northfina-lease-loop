// One reminder pass for ALL recipients: find due, undelivered reminders (including ones
// that fell due while the server was down), re-check them, and turn each lease's due
// reminders into one notification with its simulated channel artifacts.
//
// Safety against duplicates does not depend on this process: occurrences are claimed
// with an expiring token, coverage rows are unique per occurrence and channel, and the
// notification, coverage, status change and audit row commit in one transaction. If
// that transaction fails, nothing is marked sent and a later pass retries with backoff.
import { randomUUID } from 'node:crypto';
import {
  checkEligibility,
  groupDue,
  planNotification,
  retryDelaySeconds,
  type DueCandidate,
} from '@/domain/reminder-dispatch';
import type { ReminderChannel } from '@/domain/reminder-preferences';
import { lastCoveredDay } from '@/domain/reminder-schedule';
import { isLocale, type Locale } from '@/i18n/locales';
import { withAudit } from '../audit';
import type { PrismaClient } from '../prisma-client';
import { renderEmailPreview } from './email-preview';
import { preferencesFromRow } from './preferences';

export const WORKER_ACTOR = 'system:reminder-worker';

export type ReminderContacts = (recipientId: string) => Promise<{ email: string | null }>;

export type PassOptions = {
  contacts: ReminderContacts;
  /** Leases handled per pass, so one big backlog cannot starve the rest for long. */
  maxGroups?: number;
  /** A crashed worker's claim expires after this long and the work is picked up again. */
  claimSeconds?: number;
};

export type PassSummary = { notified: number; covered: number; cancelled: number; failed: number };

type OccurrenceRow = Awaited<ReturnType<PrismaClient['reminderOccurrence']['findMany']>>[number];

type Candidate = DueCandidate & { deadlineAt: string };

function toCandidate(row: OccurrenceRow): Candidate {
  return {
    deadlineAt: row.deadlineAt.toISOString(),
    id: row.id,
    contractId: row.contractId,
    recipientId: row.recipientId,
    eventVersion: row.eventVersion,
    ruleId: row.ruleId,
    daysBefore: row.daysBefore,
    dueAt: row.dueAt.toISOString(),
    channels: JSON.parse(row.channelsJson) as ReminderChannel[],
    status: row.status,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
  };
}

function dueWhere(now: Date) {
  return {
    status: 'pending',
    dueAt: { lte: now },
    AND: [
      { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      { OR: [{ claimedUntil: null }, { claimedUntil: { lt: now } }] },
    ],
  };
}

/** Runs one pass at `now`. Errors in one lease are recorded and never stop the others. */
export async function runReminderPass(
  db: PrismaClient,
  now: Date,
  options: PassOptions
): Promise<PassSummary> {
  const summary: PassSummary = { notified: 0, covered: 0, cancelled: 0, failed: 0 };
  const maxGroups = options.maxGroups ?? 25;
  const heads = await db.reminderOccurrence.findMany({
    where: dueWhere(now),
    orderBy: { dueAt: 'asc' },
    distinct: ['contractId', 'recipientId', 'eventVersion'],
    take: maxGroups,
  });
  for (const head of heads) {
    // Every due occurrence of the lease, so a missed backlog becomes ONE catch-up.
    const rows = await db.reminderOccurrence.findMany({
      where: {
        ...dueWhere(now),
        contractId: head.contractId,
        recipientId: head.recipientId,
        eventVersion: head.eventVersion,
      },
    });
    for (const group of groupDue(rows.map(toCandidate))) {
      try {
        const result = await processGroup(db, group, now, options);
        summary.notified += result.notified;
        summary.covered += result.covered;
        summary.cancelled += result.cancelled;
      } catch (error) {
        summary.failed += 1;
        console.error('Reminder delivery failed for one lease; it will be retried:', error);
        await recordFailure(db, group, now).catch((recordError: unknown) =>
          console.error('Could not record the reminder failure:', recordError)
        );
      }
    }
  }
  return summary;
}

async function claim(db: PrismaClient, ids: string[], now: Date, claimSeconds: number) {
  const token = randomUUID();
  const claimedUntil = new Date(now.getTime() + claimSeconds * 1000);
  const count = await withAudit(
    db,
    {
      actor: WORKER_ACTOR,
      action: 'reminder.claimed',
      entityType: 'reminder_occurrence',
      entityId: ids.join(','),
      details: { token, claimedUntil: claimedUntil.toISOString() },
    },
    async (tx) =>
      (
        await tx.reminderOccurrence.updateMany({
          where: {
            id: { in: ids },
            status: 'pending',
            OR: [{ claimedUntil: null }, { claimedUntil: { lt: now } }],
          },
          data: { claimToken: token, claimedUntil },
        })
      ).count
  );
  return { token, count };
}

async function processGroup(
  db: PrismaClient,
  group: Candidate[],
  now: Date,
  options: PassOptions
): Promise<{ notified: number; covered: number; cancelled: number }> {
  const first = group[0]!;
  const { token, count } = await claim(
    db,
    group.map((c) => c.id),
    now,
    options.claimSeconds ?? 120
  );
  if (count === 0) return { notified: 0, covered: 0, cancelled: 0 };
  const claimed = (
    await db.reminderOccurrence.findMany({ where: { claimToken: token, status: 'pending' } })
  ).map(toCandidate);

  const [contract, preference] = await Promise.all([
    db.contract.findUnique({ where: { id: first.contractId } }),
    db.reminderPreference.findUnique({
      where: {
        contractId_recipientId: { contractId: first.contractId, recipientId: first.recipientId },
      },
    }),
  ]);
  const preferences = preference ? preferencesFromRow(preference) : null;
  const eligible = claimed.filter(
    (c) => contract && preferences && checkEligibility(c, { endOn: contract.endOn, preferences }).ok
  );
  const stale = claimed.filter((c) => !eligible.includes(c));
  if (stale.length > 0) {
    await withAudit(
      db,
      {
        actor: WORKER_ACTOR,
        action: 'reminder.cancelled',
        entityType: 'contract',
        entityId: first.contractId,
        details: { occurrenceIds: stale.map((c) => c.id), reason: 'no_longer_applies' },
      },
      (tx) =>
        tx.reminderOccurrence.updateMany({
          where: { id: { in: stale.map((c) => c.id) }, claimToken: token, status: 'pending' },
          data: { status: 'cancelled', claimToken: null, claimedUntil: null },
        })
    );
  }
  if (!contract || !preference || !preferences || eligible.length === 0)
    return { notified: 0, covered: 0, cancelled: stale.length };

  const deadlineAt = eligible[0]!.deadlineAt;
  const plan = planNotification(eligible, now.toISOString(), deadlineAt, preferences.timeZone)!;
  const asset = await db.asset.findUnique({ where: { id: contract.assetId } });
  const itemName = asset ? `${asset.make} ${asset.model}` : contract.assetId;
  const locale: Locale = isLocale(preference.locale) ? preference.locale : 'en';
  const actionPath = `/${locale}/contracts/${contract.id}`;
  const contact = plan.channels.includes('email')
    ? await options.contacts(first.recipientId)
    : null;
  // Rendered before the transaction opens; nothing is sent anywhere.
  const email = renderEmailPreview({
    locale,
    itemName,
    endOn: contract.endOn,
    lastCoveredDay: lastCoveredDay(contract.endOn),
    deadlineAt,
    timeZone: preferences.timeZone,
    timing: plan.timing,
    catchUp: plan.catchUp,
    actionPath,
  });

  const notificationId = randomUUID();
  await withAudit(
    db,
    {
      actor: WORKER_ACTOR,
      action: 'notification.created',
      entityType: 'notification',
      entityId: notificationId,
      details: {
        contractId: contract.id,
        recipientId: first.recipientId,
        coveredOccurrenceIds: plan.coveredIds,
        channels: plan.channels,
        catchUp: plan.catchUp,
        mode: 'simulated',
      },
    },
    async (tx) => {
      await tx.notification.create({
        data: {
          id: notificationId,
          recipientId: first.recipientId,
          contractId: contract.id,
          eventVersion: first.eventVersion,
          kind: 'lease_end_reminder',
          endOn: contract.endOn,
          deadlineAt: new Date(deadlineAt),
          originalDueAt: new Date(plan.originalDueAt),
          generatedAt: now,
          catchUp: plan.catchUp,
          timingJson: JSON.stringify(plan.timing),
          payloadJson: JSON.stringify({ itemName, assetId: contract.assetId, actionPath }),
          locale,
          timeZone: preferences.timeZone,
          preferenceRevision: preference.revision,
          receipt: { create: { recipientId: first.recipientId } },
          deliveries: {
            create: plan.channels.map((channel) => ({
              id: randomUUID(),
              channel,
              mode: 'simulated',
              locale,
              createdAt: now,
              ...(channel === 'email'
                ? contact?.email
                  ? {
                      status: 'recorded',
                      toAddress: contact.email,
                      subject: email.subject,
                      bodyText: email.text,
                    }
                  : { status: 'skipped_missing_contact' }
                : { status: 'recorded' }),
            })),
          },
          coverages: {
            create: eligible.flatMap((c) =>
              c.channels.map((channel) => ({ occurrenceId: c.id, channel }))
            ),
          },
        },
      });
      const covered = await tx.reminderOccurrence.updateMany({
        where: { id: { in: plan.coveredIds }, claimToken: token, status: 'pending' },
        data: {
          status: 'covered',
          notificationId,
          coveredAt: now,
          lastAttemptAt: now,
          attempts: { increment: 1 },
          lastErrorCode: null,
          claimToken: null,
          claimedUntil: null,
        },
      });
      if (covered.count !== plan.coveredIds.length)
        throw new Error('Reminder claim was lost before delivery committed');
    }
  );
  return { notified: 1, covered: plan.coveredIds.length, cancelled: stale.length };
}

/** Records a failed attempt with a capped backoff. The reminders stay undelivered. */
async function recordFailure(db: PrismaClient, group: DueCandidate[], now: Date) {
  const rows = await db.reminderOccurrence.findMany({
    where: { id: { in: group.map((c) => c.id) }, status: 'pending' },
  });
  if (rows.length === 0) return;
  await withAudit(
    db,
    {
      actor: WORKER_ACTOR,
      action: 'reminder.attempt_failed',
      entityType: 'contract',
      entityId: group[0]!.contractId,
      details: { occurrenceIds: rows.map((r) => r.id), code: 'DELIVERY_FAILED' },
    },
    async (tx) => {
      for (const row of rows) {
        const attempts = row.attempts + 1;
        await tx.reminderOccurrence.updateMany({
          where: { id: row.id, status: 'pending' },
          data: {
            attempts,
            lastAttemptAt: now,
            lastErrorCode: 'DELIVERY_FAILED',
            nextAttemptAt: new Date(now.getTime() + retryDelaySeconds(attempts) * 1000),
            claimToken: null,
            claimedUntil: null,
          },
        });
      }
    }
  );
}
