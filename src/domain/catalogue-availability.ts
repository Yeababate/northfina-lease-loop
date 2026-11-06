// Catalogue availability: when an item can be leased, derived from its status and the end of
// its current lease. Nothing is stored: the planned ready date is "today or the current lease's
// end, whichever is later" (data/DATA.md), worked out again on every request.
import type { Asset } from '@/data/schemas';
import { isIsoDate } from './iso-date';
import { calendarDaysBetween } from './local-time';
import type { SearchParams } from './catalogue';

/** Leased items that free up within this many days show "available in N days". */
export const AVAILABILITY_WINDOW_DAYS = 30;

/** The availability filter in the URL (`avail`): now, within 7 days, within 30 days. */
export const availabilityFilters = ['now', '7', '30'] as const;
export type AvailabilityFilter = (typeof availabilityFilters)[number];

export type Availability =
  /** Can be leased today (status `available`). */
  | { kind: 'now' }
  /** Not leasable yet; planned ready on `readyOn`, `days` from today (0 = today). */
  | { kind: 'soon'; readyOn: string; days: number }
  /** Planned ready further out than the window. */
  | { kind: 'later'; readyOn: string; days: number }
  /** Reserved with no recorded lease, so there is no date to promise. */
  | { kind: 'unknown' };

/** One recorded lease of an asset: its planned end and, if it ended early or late, the actual end. */
export type LeaseEnd = { endOn: string; actualEndOn: string | null };

/**
 * The end of the asset's current (latest) lease: the latest effective end among its leases,
 * where an actual end replaces the planned one. null when the asset has no lease on record.
 * Invalid dates are ignored rather than trusted.
 */
export function currentLeaseEndOn(leases: readonly LeaseEnd[]): string | null {
  let latest: string | null = null;
  for (const lease of leases) {
    const end = lease.actualEndOn ?? lease.endOn;
    if (!isIsoDate(end)) continue;
    if (latest === null || end > latest) latest = end;
  }
  return latest;
}

/**
 * The planned ready date: the later of `today` and the current lease's end. An available item
 * is ready today. A returned item with no lease on record (an imported return) is planned for
 * today too. A reserved item with no lease on record has no date (null).
 */
export function plannedReadyOn(
  asset: Pick<Asset, 'status'>,
  leaseEndOn: string | null,
  today: string
): string | null {
  assertIsoDate(today);
  if (asset.status === 'available') return today;
  if (leaseEndOn === null || !isIsoDate(leaseEndOn))
    return asset.status === 'returned' ? today : null;
  return leaseEndOn > today ? leaseEndOn : today;
}

/** What the catalogue says about when this item can be leased. */
export function availabilityOf(
  asset: Pick<Asset, 'status'>,
  leaseEndOn: string | null,
  today: string
): Availability {
  if (asset.status === 'available') return { kind: 'now' };
  const readyOn = plannedReadyOn(asset, leaseEndOn, today);
  if (readyOn === null) return { kind: 'unknown' };
  const days = calendarDaysBetween(today, readyOn);
  return days <= AVAILABILITY_WINDOW_DAYS
    ? { kind: 'soon', readyOn, days }
    : { kind: 'later', readyOn, days };
}

/**
 * Does the item pass the availability filter? "now" keeps only leasable items; "7" and "30"
 * keep those plus items planned ready within that many days (inclusive). No filter keeps all.
 */
export function matchesAvailability(
  availability: Availability,
  filter: AvailabilityFilter | null
): boolean {
  if (filter === null || availability.kind === 'now') return true;
  if (filter === 'now' || availability.kind !== 'soon') return false;
  return availability.days <= Number(filter);
}

/** Reads `avail` from the URL; anything unknown means no availability filter. */
export function parseAvailabilityFilter(params: SearchParams): AvailabilityFilter | null {
  const raw = params.avail;
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  return (availabilityFilters as readonly string[]).includes(value)
    ? (value as AvailabilityFilter)
    : null;
}

function assertIsoDate(value: string) {
  if (!isIsoDate(value)) throw new RangeError(`Expected an ISO date, got "${value}"`);
}
