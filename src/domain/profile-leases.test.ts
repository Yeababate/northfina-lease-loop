import { describe, expect, it } from 'vitest';
import {
  effectiveLeaseEnd,
  isCompletedLease,
  leasePhase,
  parseProfileQuery,
  selectProfileLeases,
  summarizeProfileLeases,
  type ProfileLease,
} from './profile-leases';

const base: ProfileLease = {
  id: 'a',
  renterId: 'aino',
  providerId: 'dealer',
  startOn: '2026-11-05',
  endOn: '2027-11-05',
  monthlyNetCents: 10730,
  lifecycle: null,
};
const rates = [
  { rate_percent: 25.5, valid_from: '2026-01-01', valid_to: '2026-12-31' },
  { rate_percent: 26, valid_from: '2027-01-01', valid_to: null },
];

describe('lease profile', () => {
  it('classifies start-inclusive and end-exclusive dates without completing an unreturned item', () => {
    expect(leasePhase(base, '2026-11-04')).toBe('upcoming');
    expect(leasePhase(base, '2026-11-05')).toBe('active');
    expect(leasePhase(base, '2027-11-05')).toBe('ended');
    expect(isCompletedLease(base)).toBe(false);
    const completed = {
      ...base,
      lifecycle: { status: 'completed_buyout', actualEndOn: '2027-01-01' },
    };
    expect(effectiveLeaseEnd(completed)).toBe('2027-01-01');
    expect(leasePhase(completed, '2027-01-01')).toBe('ended');
    expect(isCompletedLease(completed)).toBe(true);
  });
  it('scopes both directions and filters/sorts deterministically without mutation', () => {
    const leases = [
      base,
      { ...base, id: 'b', renterId: 'other' },
      { ...base, id: 'c', startOn: '2025-01-01', endOn: '2026-01-01' },
    ];
    expect(
      selectProfileLeases(leases, 'aino', 'incoming', '2026-12-01', {
        filter: 'current',
        sort: 'start_asc',
      }).map((x) => x.id)
    ).toEqual(['a']);
    expect(
      selectProfileLeases(leases, 'aino', 'incoming', '2026-12-01', {
        filter: 'ended',
        sort: 'end_desc',
      }).map((x) => x.id)
    ).toEqual(['c']);
    expect(
      selectProfileLeases(leases, 'dealer', 'outgoing', '2026-12-01', {
        filter: 'all',
        sort: 'start_desc',
      }).map((x) => x.id)
    ).toEqual(['a', 'b', 'c']);
    expect(
      selectProfileLeases(leases, 'dealer', 'outgoing', '2026-12-01', {
        filter: 'all',
        sort: 'end_asc',
      }).map((x) => x.id)
    ).toEqual(['c', 'a', 'b']);
    expect(leases[0]).toBe(base);
  });
  it('counts agreements once and distinguishes completed history from mere expiry', () => {
    const leases = [
      base,
      { ...base, id: 'out', renterId: 'other', providerId: 'aino' },
      {
        ...base,
        id: 'ended',
        lifecycle: { status: 'completed_return', actualEndOn: '2026-10-01' },
      },
    ];
    expect(summarizeProfileLeases(leases, 'aino', '2026-12-01', rates)).toEqual({
      incoming: { active: 1, completed: 1, monthlyNetCents: 10730, monthlyGrossCents: 13466 },
      outgoing: { active: 1, completed: 0, monthlyNetCents: 10730, monthlyGrossCents: 13466 },
    });
    expect(
      summarizeProfileLeases([base], 'aino', '2027-01-01', rates).incoming.monthlyGrossCents
    ).toBe(13520);
    expect(
      summarizeProfileLeases([], 'aino', '2026-12-01', []).incoming.monthlyGrossCents
    ).toBeNull();
  });
  it('validates URL controls and provides defaults', () => {
    expect(parseProfileQuery({ filter: 'bad', sort: ['bad'] })).toEqual({
      filter: 'all',
      sort: 'start_desc',
    });
    expect(parseProfileQuery({ filter: 'ended', sort: 'end_desc' })).toEqual({
      filter: 'ended',
      sort: 'end_desc',
    });
    expect(parseProfileQuery({ filter: 'current', sort: 'start_asc' })).toEqual({
      filter: 'current',
      sort: 'start_asc',
    });
    expect(parseProfileQuery({ sort: 'end_asc' }).sort).toBe('end_asc');
  });
});
