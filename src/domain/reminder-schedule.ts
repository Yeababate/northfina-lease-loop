// Turns per-lease reminder settings into concrete reminder occurrences.
//
// Deadline: the lease end is exclusive (`endOn` is the first day not covered), so the
// event happens at 00:00 on `endOn` in the business time zone (Helsinki). That instant
// is then viewed in the renter's saved zone. "N days before" counts calendar days back
// from the deadline's local date (not N × 24 hours), at the chosen local clock time.
// A reminder at or after the deadline is rejected.
import { addCalendarDays, localDateTime, resolveLocalTime } from './local-time';
import {
  activeRules,
  type ReminderChannel,
  type ReminderPreferences,
  type ReminderRule,
} from './reminder-preferences';

export const BUSINESS_TIME_ZONE = 'Europe/Helsinki';

export type LeaseEvent = {
  contractId: string;
  recipientId: string;
  /** Exclusive end date of the lease, `YYYY-MM-DD`. */
  endOn: string;
};

/** The deadline instant: the start of `endOn` in the business time zone. */
export function leaseEndDeadline(endOn: string, businessZone = BUSINESS_TIME_ZONE): string {
  return resolveLocalTime(endOn, '00:00', businessZone).instant;
}

/** The last calendar day the lease covers, for labels only (`endOn` minus one day). */
export function lastCoveredDay(endOn: string): string {
  return addCalendarDays(endOn, -1);
}

/** A new end date makes a new event version, which supersedes unsent reminders. */
export function eventVersion(endOn: string): string {
  return `end:${endOn}`;
}

/**
 * Identity of one reminder occurrence. It contains the rule's stable ID and its day
 * offset but not the clock time or zone: moving a reminder from 09:00 to 10:00 keeps
 * the same occurrence, so one already delivered is not sent again.
 */
export function occurrenceKey(event: LeaseEvent, rule: Pick<ReminderRule, 'id' | 'daysBefore'>) {
  return [event.contractId, event.recipientId, eventVersion(event.endOn), rule.id, rule.daysBefore]
    .map((part) => encodeURIComponent(String(part)))
    .join('|');
}

export type PlannedOccurrence = {
  key: string;
  ruleId: string;
  daysBefore: number;
  localDate: string;
  localTime: string;
  timeZone: string;
  dueAt: string;
  adjustment: 'none' | 'gap' | 'fold';
  channels: ReminderChannel[];
  /** `already_past`: due before these settings were saved, so it is not sent late. */
  state: 'scheduled' | 'already_past';
};

export type ScheduleProblem = { ruleId: string; reason: 'after_end' };

export type Schedule = {
  eventVersion: string;
  deadlineAt: string;
  occurrences: PlannedOccurrence[];
  problems: ScheduleProblem[];
};

/**
 * The schedule for one lease and recipient, as of `activatedAt` (the instant the
 * settings are saved). Occurrences are sorted by due time.
 */
export function planSchedule(
  event: LeaseEvent,
  preferences: ReminderPreferences,
  activatedAt: string,
  businessZone = BUSINESS_TIME_ZONE
): Schedule {
  const deadlineAt = leaseEndDeadline(event.endOn, businessZone);
  const deadlineDate = localDateTime(deadlineAt, preferences.timeZone).date;
  const occurrences: PlannedOccurrence[] = [];
  const problems: ScheduleProblem[] = [];
  for (const rule of activeRules(preferences)) {
    const localDate = addCalendarDays(deadlineDate, -rule.daysBefore);
    const resolved = resolveLocalTime(localDate, rule.time, preferences.timeZone);
    if (Date.parse(resolved.instant) >= Date.parse(deadlineAt)) {
      problems.push({ ruleId: rule.id, reason: 'after_end' });
      continue;
    }
    occurrences.push({
      key: occurrenceKey(event, rule),
      ruleId: rule.id,
      daysBefore: rule.daysBefore,
      localDate,
      localTime: rule.time,
      timeZone: preferences.timeZone,
      dueAt: resolved.instant,
      adjustment: resolved.adjustment,
      channels: rule.channels,
      state: Date.parse(resolved.instant) > Date.parse(activatedAt) ? 'scheduled' : 'already_past',
    });
  }
  occurrences.sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  return { eventVersion: eventVersion(event.endOn), deadlineAt, occurrences, problems };
}
