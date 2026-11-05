// How much time is left until the lease ends, worded from a given moment. Used both
// when a reminder is generated (saved with it) and when it is shown later, so an old
// unread reminder never says "7 days left" after the deadline has come closer or passed.
import { calendarDaysBetween, localDateTime, minutesBetween } from './local-time';

export type TimeRemaining =
  /** Calendar days left in the recipient's zone, at least 1. */
  | { kind: 'days'; days: number }
  /** The deadline is later today (local): whole hours left, rounded up, at least 1. */
  | { kind: 'hours'; hours: number }
  /** The deadline has passed; `days` calendar days ago (0 = earlier today). */
  | { kind: 'ended'; days: number };

export function timeRemaining(now: string, deadlineAt: string, timeZone: string): TimeRemaining {
  const today = localDateTime(now, timeZone).date;
  const deadlineDay = localDateTime(deadlineAt, timeZone).date;
  if (Date.parse(now) >= Date.parse(deadlineAt))
    return { kind: 'ended', days: calendarDaysBetween(deadlineDay, today) };
  const days = calendarDaysBetween(today, deadlineDay);
  if (days >= 1) return { kind: 'days', days };
  return { kind: 'hours', hours: Math.max(1, Math.ceil(minutesBetween(now, deadlineAt) / 60)) };
}
