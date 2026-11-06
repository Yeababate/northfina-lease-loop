// "Do you still want this?" for waiting-list entries whose needed-by date has passed (#75).
// The date rules are in src/domain/waiting-list-follow-up.ts; this file applies them.
//
// The message goes out through the existing reminder channels: one Notification row in the
// customer's inbox (GET /api/notifications) with an in-app and a simulated email delivery,
// the same tables and shape the lease-end reminders use. It runs as one more job of the
// reminder worker (./reminders/worker.ts), so there is no second notification system.
//
// Each entry is handled in its own transaction: the notification, the entry change and the
// audit row commit together. The entry update is conditional (still waiting, not yet asked,
// same needed-by), so two workers or a retry can never send the question twice.
import { randomUUID } from 'node:crypto';
import type { AssetCategory } from '@/data/schemas';
import { resolveLocalTime, addCalendarDays } from '@/domain/local-time';
import { BUSINESS_TIME_ZONE } from '@/domain/reminder-schedule';
import { timeRemaining } from '@/domain/reminder-timing';
import {
  canAnswerStillWanted,
  checkNewNeededBy,
  followUpStep,
  replyLastDay,
} from '@/domain/waiting-list-follow-up';
import { formatIsoDate } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import { isLocale, type Locale } from '@/i18n/locales';
import { ApiError } from './api-response';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';
import type { ReminderContacts } from './reminders/processor';

export const FOLLOW_UP_ACTOR = 'system:waiting-list-follow-up';
export const STILL_WANTED_KIND = 'waiting_list_still_wanted';

type EntryRow = Awaited<ReturnType<PrismaClient['waitingListEntry']['findFirstOrThrow']>>;

export type FollowUpSummary = { asked: number; expired: number; failed: number };

/** The page that answers the question, in the customer's language. */
export function entryPath(locale: Locale, entryId: string): string {
  return `/${locale}/waiting-list/${encodeURIComponent(entryId)}`;
}

/** The simulated email, rendered from the shared message files. Nothing is sent. */
export function renderStillWantedEmail(
  locale: Locale,
  entry: { category: string; neededBy: string },
  replyBy: string,
  link: string
): { subject: string; text: string } {
  const t = getT(locale);
  // Mid-sentence, so lower case ("a used laptop"); none of the four languages capitalises it.
  const kind = t(`categoryOne.${entry.category as AssetCategory}`).toLocaleLowerCase(locale);
  const date = formatIsoDate(entry.neededBy, locale);
  return {
    subject: t('waitlist.email.subject', { kind }),
    text: [
      t('waitlist.email.body', { kind, date, replyBy: formatIsoDate(replyBy, locale) }),
      t('waitlist.email.action', { link }),
      '',
      t('waitlist.email.simulated'),
    ].join('\n'),
  };
}

/**
 * One follow-up pass: asks every open customer entry whose needed-by has passed, and expires
 * the ones asked more than REPLY_DAYS ago without an answer. Data-pack entries have no
 * customer to ask and are left as they are. One failing entry never stops the others.
 */
export async function runWaitingListFollowUp(
  db: PrismaClient,
  today: string,
  now: Date,
  options: { contacts: ReminderContacts }
): Promise<FollowUpSummary> {
  const summary: FollowUpSummary = { asked: 0, expired: 0, failed: 0 };
  const rows = await db.waitingListEntry.findMany({
    where: {
      status: 'waiting',
      participantId: { not: null },
      OR: [
        { stillWantedAskedOn: null, neededBy: { lt: today } },
        { stillWantedAskedOn: { not: null } },
      ],
    },
    orderBy: { id: 'asc' },
  });
  for (const row of rows) {
    const step = followUpStep(row, today);
    try {
      if (step === 'ask' && (await askStillWanted(db, row, today, now, options.contacts)))
        summary.asked += 1;
      if (step === 'expire' && (await expireUnanswered(db, row, today))) summary.expired += 1;
    } catch (error) {
      summary.failed += 1;
      console.error('Waiting-list follow-up failed for one entry; it runs again next pass:', error);
    }
  }
  return summary;
}

async function askStillWanted(
  db: PrismaClient,
  row: EntryRow,
  today: string,
  now: Date,
  contacts: ReminderContacts
): Promise<boolean> {
  const recipientId = row.participantId!;
  const locale: Locale = isLocale(row.locale) ? row.locale : 'en';
  const replyBy = replyLastDay(today);
  // The reply window closes when the day after the last reply day starts, business time.
  const deadlineAt = resolveLocalTime(
    addCalendarDays(replyBy, 1),
    '00:00',
    BUSINESS_TIME_ZONE
  ).instant;
  const actionPath = entryPath(locale, row.id);
  const contact = await contacts(recipientId);
  const email = renderStillWantedEmail(locale, row, replyBy, actionPath);
  const notificationId = randomUUID();
  const t = getT(locale);
  return withAudit(
    db,
    {
      actor: FOLLOW_UP_ACTOR,
      action: 'waiting_list.still_wanted_asked',
      entityType: 'waiting_list',
      entityId: row.id,
      details: { notificationId, recipientId, neededBy: row.neededBy, replyBy, mode: 'simulated' },
    },
    async (tx) => {
      const marked = await tx.waitingListEntry.updateMany({
        where: { id: row.id, status: 'waiting', stillWantedAskedOn: null, neededBy: row.neededBy },
        data: { stillWantedAskedOn: today },
      });
      // Someone else asked, or the customer answered first: send nothing, write nothing.
      if (marked.count !== 1) throw new SkipEntry();
      await tx.notification.create({
        data: {
          id: notificationId,
          recipientId,
          waitingListEntryId: row.id,
          eventVersion: row.neededBy,
          kind: STILL_WANTED_KIND,
          endOn: row.neededBy,
          deadlineAt: new Date(deadlineAt),
          originalDueAt: now,
          generatedAt: now,
          catchUp: false,
          timingJson: JSON.stringify(
            timeRemaining(now.toISOString(), deadlineAt, BUSINESS_TIME_ZONE)
          ),
          payloadJson: JSON.stringify({
            itemName: t(`categoryOne.${row.category as AssetCategory}`),
            assetId: row.offeredAssetId ?? '',
            actionPath,
          }),
          locale,
          timeZone: BUSINESS_TIME_ZONE,
          preferenceRevision: 0,
          receipt: { create: { recipientId } },
          deliveries: {
            create: (['email', 'in_app'] as const).map((channel) => ({
              id: randomUUID(),
              channel,
              mode: 'simulated',
              locale,
              createdAt: now,
              ...(channel === 'email'
                ? contact.email
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
        },
      });
      return true;
    }
  ).catch((error: unknown) => {
    if (error instanceof SkipEntry) return false;
    throw error;
  });
}

/** Thrown inside a transaction to roll it back quietly when the entry changed meanwhile. */
class SkipEntry extends Error {}

async function expireUnanswered(db: PrismaClient, row: EntryRow, today: string) {
  return withAudit(
    db,
    {
      actor: FOLLOW_UP_ACTOR,
      action: 'waiting_list.expired',
      entityType: 'waiting_list',
      entityId: row.id,
      details: { reason: 'no_reply', askedOn: row.stillWantedAskedOn },
    },
    async (tx) => {
      const expired = await tx.waitingListEntry.updateMany({
        where: { id: row.id, status: 'waiting', stillWantedAskedOn: row.stillWantedAskedOn },
        data: { status: 'expired', expiredOn: today, expiredReason: 'no_reply' },
      });
      if (expired.count !== 1) throw new SkipEntry();
      return true;
    }
  ).catch((error: unknown) => {
    if (error instanceof SkipEntry) return false;
    throw error;
  });
}

export type StillWantedAnswer = { answer: 'yes'; neededBy: string } | { answer: 'no' };

/**
 * The customer's answer. "yes" moves needed-by to a new date strictly after today and keeps
 * the entry's place (signed_up_on is unchanged); a later date passing asks again. "no"
 * expires the entry now. Only the entry's owner may answer, only while an answer is open.
 */
export async function answerStillWanted(
  db: PrismaClient,
  participantId: string,
  entryId: string,
  answer: StillWantedAnswer,
  today: string
) {
  const entry = await db.waitingListEntry.findFirst({ where: { id: entryId, participantId } });
  if (!entry) throw new ApiError(404, 'WAITING_ENTRY_NOT_FOUND', 'Waiting-list request not found');
  if (!canAnswerStillWanted(entry, today))
    throw new ApiError(409, 'NOT_ASKED', 'This request is not waiting for an answer');
  if (answer.answer === 'yes') {
    const check = checkNewNeededBy(answer.neededBy, today);
    if (!check.ok)
      throw new ApiError(422, 'INVALID_NEEDED_BY', 'Choose a date after today', [check.problem]);
  }
  const data =
    answer.answer === 'yes'
      ? { neededBy: answer.neededBy, stillWantedAskedOn: null }
      : { status: 'expired', expiredOn: today, expiredReason: 'declined' };
  return withAudit(
    db,
    {
      actor: participantId,
      action: answer.answer === 'yes' ? 'waiting_list.still_wanted' : 'waiting_list.declined',
      entityType: 'waiting_list',
      entityId: entryId,
      details: answer.answer === 'yes' ? { from: entry.neededBy, to: answer.neededBy } : {},
    },
    async (tx) => {
      const changed = await tx.waitingListEntry.updateMany({
        where: {
          id: entryId,
          participantId,
          status: 'waiting',
          neededBy: entry.neededBy,
          stillWantedAskedOn: entry.stillWantedAskedOn,
        },
        data,
      });
      if (changed.count !== 1)
        throw new ApiError(409, 'NOT_ASKED', 'This request is not waiting for an answer');
      return tx.waitingListEntry.findUniqueOrThrow({ where: { id: entryId } });
    }
  );
}
