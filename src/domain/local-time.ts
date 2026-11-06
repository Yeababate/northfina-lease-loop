// Local wall-clock time in an IANA time zone, converted to and from UTC instants.
// Instants are ISO strings in UTC (`2026-11-05T07:00:00.000Z`) chosen by the caller;
// nothing here reads the clock. Intl's built-in zone database does the offset lookups.
//
// Daylight-saving rules (documented on purpose, see the tests):
// - A local time that does not exist (spring gap) moves forward by the length of the gap:
//   03:30 on the Helsinki spring-forward day becomes 04:30 local time.
// - A local time that happens twice (autumn fold) uses the earlier occurrence.

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MINUTE = 60_000;
const DAY = 86_400_000;

export const FALLBACK_TIME_ZONE = 'Europe/Helsinki';

export function isClockTime(value: string): boolean {
  return HH_MM.test(value);
}

/**
 * True for a named IANA zone such as `Europe/Tallinn` or `UTC`. Fixed offsets such as
 * `+02:00` are rejected: they do not follow daylight-saving changes.
 */
export function isValidTimeZone(zone: string): boolean {
  if (zone.length === 0 || zone.length > 64) return false;
  if (zone !== 'UTC' && !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, found);
  }
  return found;
}

/** Wall-clock fields of an instant (epoch ms) in `zone`, as epoch ms "as if UTC". */
function wallClockMs(epochMs: number, zone: string): number {
  const parts = formatter(zone).formatToParts(new Date(epochMs));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
}

function offsetMs(epochMs: number, zone: string): number {
  return wallClockMs(epochMs, zone) - Math.floor(epochMs / 1000) * 1000;
}

function parseDate(date: string): [number, number, number] {
  const match = ISO_DATE.exec(date);
  if (!match) throw new RangeError(`Expected YYYY-MM-DD, got "${date}"`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function toIsoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export type ResolvedLocalTime = {
  /** The UTC instant, ISO 8601. */
  instant: string;
  /** `gap`: the local time did not exist and moved forward; `fold`: it happened twice. */
  adjustment: 'none' | 'gap' | 'fold';
};

/** The instant at which `date` `time` happens on a wall clock in `zone` (rules above). */
export function resolveLocalTime(date: string, time: string, zone: string): ResolvedLocalTime {
  const [year, month, day] = parseDate(date);
  const clock = HH_MM.exec(time);
  if (!clock) throw new RangeError(`Expected HH:MM, got "${time}"`);
  if (!isValidTimeZone(zone)) throw new RangeError(`Unknown time zone "${zone}"`);
  const local = Date.UTC(year, month - 1, day, Number(clock[1]), Number(clock[2]));
  const before = offsetMs(local - DAY, zone);
  const after = offsetMs(local + DAY, zone);
  const candidates = [...new Set([local - before, local - after])]
    .filter((instant) => wallClockMs(instant, zone) === local)
    .sort((a, b) => a - b);
  if (candidates.length === 0) {
    // Nonexistent local time: the offset in force before the gap moves it forward.
    return { instant: new Date(local - before).toISOString(), adjustment: 'gap' };
  }
  return {
    instant: new Date(candidates[0]!).toISOString(),
    adjustment: candidates.length > 1 ? 'fold' : 'none',
  };
}

/** The local calendar date and HH:MM of an instant in `zone`. */
export function localDateTime(instant: string, zone: string): { date: string; time: string } {
  const wall = new Date(wallClockMs(Date.parse(instant), zone)).toISOString();
  return { date: wall.slice(0, 10), time: wall.slice(11, 16) };
}

/** `date` plus `days` calendar days (negative goes back). */
export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = parseDate(date);
  return toIsoDate(Date.UTC(year, month - 1, day) + days * DAY);
}

/** Whole calendar days from `from` to `to` (`to` later gives a positive number). */
export function calendarDaysBetween(from: string, to: string): number {
  const [y1, m1, d1] = parseDate(from);
  const [y2, m2, d2] = parseDate(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY);
}

/** Minutes from instant `from` to instant `to`, rounded down. */
export function minutesBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / MINUTE);
}
