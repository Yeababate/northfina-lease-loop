import type { VatRate } from '@/data/schemas';
import { vatCents, vatRateOn } from './vat';

export type ProfileLease = {
  id: string;
  renterId: string | null;
  providerId: string | null;
  startOn: string;
  endOn: string;
  monthlyNetCents: number;
  lifecycle: { status: string; actualEndOn: string | null } | null;
};
export type LeasePhase = 'upcoming' | 'active' | 'ended';
export type LeaseFilter = 'all' | 'current' | 'ended';
export type LeaseSort = 'start_asc' | 'start_desc' | 'end_asc' | 'end_desc';
export type LeaseDirection = 'incoming' | 'outgoing';

/** Actual operational completion is not inferred from a passed calendar date. */
export function isCompletedLease(lease: ProfileLease): boolean {
  return ['completed_return', 'completed_buyout', 'passed_on'].includes(
    lease.lifecycle?.status ?? ''
  );
}

export function effectiveLeaseEnd(lease: ProfileLease): string {
  return lease.lifecycle?.actualEndOn ?? lease.endOn;
}

/** Start inclusive, end exclusive, matching the signed contract calendar. */
export function leasePhase(lease: ProfileLease, today: string): LeasePhase {
  if (isCompletedLease(lease) || today >= effectiveLeaseEnd(lease)) return 'ended';
  return today < lease.startOn ? 'upcoming' : 'active';
}

export function parseProfileQuery(params: Record<string, string | string[] | undefined>): {
  filter: LeaseFilter;
  sort: LeaseSort;
} {
  const filter = params.filter;
  const sort = params.sort;
  return {
    filter: filter === 'current' || filter === 'ended' ? filter : 'all',
    sort: sort === 'start_asc' || sort === 'end_asc' || sort === 'end_desc' ? sort : 'start_desc',
  };
}

/** Filter a participant's own view, then sort a copy with deterministic ties. */
export function selectProfileLeases<T extends ProfileLease>(
  leases: readonly T[],
  userId: string,
  direction: LeaseDirection,
  today: string,
  query: { filter: LeaseFilter; sort: LeaseSort }
): T[] {
  const field = direction === 'incoming' ? 'renterId' : 'providerId';
  const key = query.sort.startsWith('start') ? (lease: T) => lease.startOn : effectiveLeaseEnd;
  const sign = query.sort.endsWith('asc') ? 1 : -1;
  return leases
    .filter(
      (lease) =>
        lease[field] === userId &&
        (query.filter === 'all' ||
          (leasePhase(lease, today) === 'ended') === (query.filter === 'ended'))
    )
    .sort((a, b) => sign * key(a).localeCompare(key(b)) || a.id.localeCompare(b.id));
}

/** Totals are for all scoped records, independent of table filters. VAT rounds per lease. */
export function summarizeProfileLeases(
  leases: readonly ProfileLease[],
  userId: string,
  today: string,
  rates: readonly VatRate[]
) {
  const rate = vatRateOn(rates, today);
  const summarize = (field: 'renterId' | 'providerId') => {
    const own = leases.filter((lease) => lease[field] === userId);
    const active = own.filter((lease) => leasePhase(lease, today) === 'active');
    return {
      active: active.length,
      completed: own.filter(isCompletedLease).length,
      monthlyNetCents: active.reduce((sum, lease) => sum + lease.monthlyNetCents, 0),
      monthlyGrossCents: rate.ok
        ? active.reduce(
            (sum, lease) =>
              sum + lease.monthlyNetCents + vatCents(lease.monthlyNetCents, rate.rate.rate_percent),
            0
          )
        : null,
    };
  };
  return { incoming: summarize('renterId'), outgoing: summarize('providerId') };
}
