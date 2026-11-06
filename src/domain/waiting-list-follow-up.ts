// What happens to a customer's waiting-list entry after its "needed by" date (issue #75), and
// when they can expect to receive a matched item. All dates are ISO `YYYY-MM-DD` strings,
// compared as strings (that is safe for this format) and moved with addCalendarDays.
//
// The rules:
//   - needed_by is the last day the customer still wants the item. The day after it, an
//     open ("waiting") entry is asked once: "Do you still want this?".
//   - The customer has REPLY_DAYS days to answer, counted from the day they were asked: asked
//     on 1 Dec, the last day to reply is 15 Dec, and the entry expires on 16 Dec. We chose the
//     generous reading of "no reply after 14 days" so nobody loses their place a day early.
//   - "Yes" needs a new needed-by date strictly after today; "No" expires the entry at once.
//   - Only "waiting" entries are asked. An "offered" entry already holds an item through its
//     needed_by (data/DATA.md), and the matching's own rules end that hold.
import { isIsoDate } from './iso-date';
import { addCalendarDays } from './local-time';

/** Days the customer has to answer "Do you still want this?", counted after the day asked. */
export const REPLY_DAYS = 14;

export type FollowUpEntry = {
  status: string;
  neededBy: string;
  /** The day the question was sent; null when it has not been (or was answered "yes"). */
  stillWantedAskedOn: string | null;
};

export type FollowUpStep = 'none' | 'ask' | 'expire';

/** True from the day after needed_by onwards. */
export function neededByPassed(neededBy: string, today: string): boolean {
  return today > neededBy;
}

/** The last day an answer is accepted, for a question sent on `askedOn`. */
export function replyLastDay(askedOn: string): string {
  return addCalendarDays(askedOn, REPLY_DAYS);
}

/** What the daily follow-up should do with this entry today. */
export function followUpStep(entry: FollowUpEntry, today: string): FollowUpStep {
  if (entry.status !== 'waiting') return 'none';
  if (entry.stillWantedAskedOn !== null)
    return today > replyLastDay(entry.stillWantedAskedOn) ? 'expire' : 'none';
  return neededByPassed(entry.neededBy, today) ? 'ask' : 'none';
}

/**
 * Whether the customer may answer today: the entry is still open, its needed_by has passed,
 * and, if they were asked, the reply window has not closed. They may answer before the
 * message reaches them (the question is due as soon as needed_by passes).
 */
export function canAnswerStillWanted(entry: FollowUpEntry, today: string): boolean {
  if (entry.status !== 'waiting' || !neededByPassed(entry.neededBy, today)) return false;
  return entry.stillWantedAskedOn === null || today <= replyLastDay(entry.stillWantedAskedOn);
}

export type NewNeededByProblem = 'not_a_date' | 'not_in_future';

/** A new needed-by date for a "yes": a real calendar day strictly after today. */
export function checkNewNeededBy(
  date: string,
  today: string
): { ok: true } | { ok: false; problem: NewNeededByProblem } {
  if (!isIsoDate(date)) return { ok: false, problem: 'not_a_date' };
  if (date <= today) return { ok: false, problem: 'not_in_future' };
  return { ok: true };
}

/**
 * When the customer can expect the matched item: its planned ready date. The data pack has
 * no work durations, so that is today or the end of the lease the item is coming back from,
 * whichever is later (data/DATA.md, "Waiting-list offers"; the matcher uses the same rule).
 * `leaseEndOn` is null for an item with no lease to wait for.
 */
export function expectedReceivingDate(today: string, leaseEndOn: string | null): string {
  return leaseEndOn !== null && leaseEndOn > today ? leaseEndOn : today;
}
