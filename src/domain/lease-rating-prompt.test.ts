import { describe, expect, it } from 'vitest';
import { leaseRatingPrompt } from './lease-rating-prompt';

const lease = { id: 'c1', renterId: 'renter', providerId: 'provider', status: 'completed_return' };

describe('leaseRatingPrompt', () => {
  it('invites a rating once the lease ended with a return or a buyout', () => {
    expect(leaseRatingPrompt(lease, 'renter', null)).toEqual({ kind: 'rate' });
    expect(leaseRatingPrompt({ ...lease, status: 'completed_buyout' }, 'renter', null)).toEqual({
      kind: 'rate',
    });
  });

  it('shows the own stars when the lease is already rated', () => {
    expect(leaseRatingPrompt(lease, 'renter', 4)).toEqual({ kind: 'rated', stars: 4 });
    expect(leaseRatingPrompt(lease, 'renter', 1)).toEqual({ kind: 'rated', stars: 1 });
  });

  it('keeps showing an existing rating even if the lease could no longer be rated', () => {
    expect(leaseRatingPrompt({ ...lease, status: 'active' }, 'renter', 5)).toEqual({
      kind: 'rated',
      stars: 5,
    });
  });

  it('says nothing while the lease is still running or awaiting a signature', () => {
    for (const status of ['active', 'awaiting_signature', 'pending_exit']) {
      expect(leaseRatingPrompt({ ...lease, status }, 'renter', null)).toEqual({ kind: 'none' });
    }
  });

  it('says nothing for a lease passed on to the next renter, which cannot be rated', () => {
    expect(leaseRatingPrompt({ ...lease, status: 'passed_on' }, 'renter', null)).toEqual({
      kind: 'none',
    });
  });

  it('says nothing when the viewer is not a participant or there is no provider', () => {
    expect(leaseRatingPrompt(lease, 'stranger', null)).toEqual({ kind: 'none' });
    expect(leaseRatingPrompt({ ...lease, providerId: null }, 'renter', null)).toEqual({
      kind: 'none',
    });
    expect(leaseRatingPrompt({ ...lease, providerId: 'renter' }, 'renter', null)).toEqual({
      kind: 'none',
    });
  });
});
