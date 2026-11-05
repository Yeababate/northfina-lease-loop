// Which reminders are due, whether they still apply, and how several missed ones become
// one up-to-date catch-up notification. Time ("now") is always passed in.
import type { ReminderChannel, ReminderPreferences } from './reminder-preferences';
import { REMINDER_CHANNELS } from './reminder-preferences';
import { eventVersion } from './reminder-schedule';
import { timeRemaining, type TimeRemaining } from './reminder-timing';

/** A reminder sent more than this long after its due time counts as a catch-up. */
export const CATCH_UP_AFTER_MINUTES = 10;
/** Retry delays double from 30 s up to this cap; a failed reminder keeps retrying. */
export const MAX_RETRY_DELAY_SECONDS = 3600;
const FIRST_RETRY_DELAY_SECONDS = 30;

export type DueCandidate = {
  id: string;
  contractId: string;
  recipientId: string;
  eventVersion: string;
  ruleId: string;
  daysBefore: number;
  dueAt: string;
  channels: ReminderChannel[];
  status: string;
  nextAttemptAt: string | null;
};

/** Pending, due by `now`, and not waiting for a retry. Future reminders are never due. */
export function isDue(candidate: DueCandidate, now: string): boolean {
  const at = Date.parse(now);
  return (
    candidate.status === 'pending' &&
    Date.parse(candidate.dueAt) <= at &&
    (candidate.nextAttemptAt === null || Date.parse(candidate.nextAttemptAt) <= at)
  );
}

export type Eligibility = { ok: true } | { ok: false; reason: 'superseded' | 'disabled' };

/**
 * Re-checks a due reminder against the lease and settings as they are now: a changed
 * end date or a removed, switched-off or re-timed rule means it no longer applies.
 */
export function checkEligibility(
  candidate: Pick<DueCandidate, 'eventVersion' | 'ruleId' | 'daysBefore'>,
  current: { endOn: string; preferences: ReminderPreferences }
): Eligibility {
  if (candidate.eventVersion !== eventVersion(current.endOn))
    return { ok: false, reason: 'superseded' };
  if (!current.preferences.enabled) return { ok: false, reason: 'disabled' };
  const rule = current.preferences.rules.find((r) => r.id === candidate.ruleId);
  if (!rule || !rule.enabled || rule.daysBefore !== candidate.daysBefore)
    return { ok: false, reason: 'superseded' };
  return { ok: true };
}

/** Groups due reminders by recipient, lease and event version: one message per group. */
export function groupDue<T extends DueCandidate>(candidates: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const candidate of candidates) {
    const key = [candidate.recipientId, candidate.contractId, candidate.eventVersion].join('|');
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  return [...groups.values()];
}

export type NotificationPlan = {
  coveredIds: string[];
  channels: ReminderChannel[];
  catchUp: boolean;
  /** The earliest original due time among the covered reminders. */
  originalDueAt: string;
  timing: TimeRemaining;
};

/**
 * One notification for a group of due reminders. Its timing is the actual time left at
 * `now`, not the label of any original threshold. Channels are the union of the covered
 * reminders' channels. Returns null for an empty group.
 */
export function planNotification(
  due: readonly DueCandidate[],
  now: string,
  deadlineAt: string,
  timeZone: string
): NotificationPlan | null {
  if (due.length === 0) return null;
  const sorted = [...due].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  const latest = Date.parse(sorted[sorted.length - 1]!.dueAt);
  const lateMinutes = (Date.parse(now) - latest) / 60_000;
  return {
    coveredIds: sorted.map((candidate) => candidate.id),
    channels: REMINDER_CHANNELS.filter((channel) =>
      sorted.some((candidate) => candidate.channels.includes(channel))
    ),
    catchUp: sorted.length > 1 || lateMinutes > CATCH_UP_AFTER_MINUTES,
    originalDueAt: sorted[0]!.dueAt,
    timing: timeRemaining(now, deadlineAt, timeZone),
  };
}

/** Delay before retry number `attempts` (1 = first retry): 30 s, 60 s, 120 s ... capped. */
export function retryDelaySeconds(attempts: number): number {
  const exponent = Math.min(Math.max(attempts, 1) - 1, 20);
  return Math.min(FIRST_RETRY_DELAY_SECONDS * 2 ** exponent, MAX_RETRY_DELAY_SECONDS);
}
