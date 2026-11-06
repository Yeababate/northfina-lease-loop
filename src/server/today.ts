// "Today" for the app, as an ISO date. Domain code never reads the clock itself:
// pages and routes call this once and pass the result in.
//
// Demo date: start the server with LEASE_LOOP_TODAY=YYYY-MM-DD and the whole app behaves as
// if it were that day (prices, signing, invoices, early exit, second life). It is how the
// dated scenario cards are replayed, e.g. card 1 "signed 5 Nov 2026". An invalid value is
// ignored. A date passed in explicitly always wins.
import { isIsoDate } from '@/domain/iso-date';

/** The calendar date of `now` in `timeZone` (Helsinki by default), as `YYYY-MM-DD`. */
export function todayIso(now?: Date, timeZone = 'Europe/Helsinki'): string {
  if (now === undefined) {
    const demo = demoToday();
    if (demo) return demo;
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now ?? new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The demo date from LEASE_LOOP_TODAY, or null when it is not set or not a real date. */
export function demoToday(): string | null {
  const value = process.env.LEASE_LOOP_TODAY?.trim();
  return value && isIsoDate(value) ? value : null;
}
