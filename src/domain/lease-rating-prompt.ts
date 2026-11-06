// What a lease card on "My leases" says about rating that lease: the customer's own stars when
// they have rated it, an invitation to rate once the lease is completed, or nothing. It mirrors
// the contract page, which shows the rating form when the lease may be rated or a rating exists
// (ratingEligibility in ./ratings.ts), so the card never links to a form that is not there.
import { ratingEligibility, type RatingContract } from './ratings';

export type LeaseRatingPrompt =
  { kind: 'rated'; stars: number } | { kind: 'rate' } | { kind: 'none' };

/**
 * @param contract the lease, with `status` the lifecycle status ('active' when it has none).
 * @param viewerId the signed-in customer.
 * @param ownStars the stars of the viewer's own rating of this lease, or null if they have none.
 */
export function leaseRatingPrompt(
  contract: RatingContract,
  viewerId: string,
  ownStars: number | null
): LeaseRatingPrompt {
  if (ownStars !== null) return { kind: 'rated', stars: ownStars };
  return ratingEligibility(contract, viewerId).ok ? { kind: 'rate' } : { kind: 'none' };
}
