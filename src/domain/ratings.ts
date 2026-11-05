import { divideRoundHalfUp } from './rounding';

export type RatingDirection = 'renter_to_provider' | 'provider_to_renter';
export type RatingVisibility = 'visible' | 'hidden';
export type RatingContract = {
  id: string;
  renterId: string | null;
  providerId: string | null;
  status: string;
};

/** Only an actual completed rental gives its two participants a review relationship. */
export function ratingEligibility(contract: RatingContract, reviewerId: string) {
  if (!contract.renterId || !contract.providerId)
    return { ok: false, reason: 'participants_missing' } as const;
  if (contract.renterId === contract.providerId)
    return { ok: false, reason: 'self_rating' } as const;
  if (reviewerId !== contract.renterId && reviewerId !== contract.providerId)
    return { ok: false, reason: 'not_participant' } as const;
  if (!['completed_return', 'completed_buyout'].includes(contract.status))
    return { ok: false, reason: 'not_completed' } as const;
  return reviewerId === contract.renterId
    ? ({ ok: true, subjectId: contract.providerId, direction: 'renter_to_provider' } as const)
    : ({ ok: true, subjectId: contract.renterId, direction: 'provider_to_renter' } as const);
}

/** Plain text is kept as text; rendering code must never interpret it as HTML. */
export function validateRating(stars: unknown, comment: unknown = '') {
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5)
    return { ok: false, reason: 'invalid_stars' } as const;
  if (typeof comment !== 'string') return { ok: false, reason: 'invalid_comment' } as const;
  const text = comment.trim();
  if (text.length > 2000) return { ok: false, reason: 'comment_too_long' } as const;
  return { ok: true, stars, comment: text } as const;
}

export type EditableRating = {
  reviewerId: string;
  currentRevision: number;
  visibility: RatingVisibility;
};

/** Editing creates one new revision; moderation state is never reset by the author. */
export function planRatingEdit(
  current: EditableRating,
  actorId: string,
  expectedRevision: number,
  stars: unknown,
  comment: unknown = ''
) {
  if (current.reviewerId !== actorId) return { ok: false, reason: 'not_author' } as const;
  if (expectedRevision !== current.currentRevision)
    return { ok: false, reason: 'stale_revision' } as const;
  if (
    !Number.isSafeInteger(current.currentRevision) ||
    current.currentRevision < 1 ||
    current.currentRevision === Number.MAX_SAFE_INTEGER
  )
    return { ok: false, reason: 'invalid_revision' } as const;
  const valid = validateRating(stars, comment);
  if (!valid.ok) return valid;
  return {
    ...valid,
    currentRevision: current.currentRevision + 1,
    visibility: current.visibility,
  } as const;
}

export type SummaryRating = {
  subjectId: string;
  direction: RatingDirection;
  stars: number;
  visibility: RatingVisibility;
};

/** Current visible ratings only. No reviews is distinct from a zero-star score. */
export function summarizeRatings(
  ratings: readonly SummaryRating[],
  subjectId: string,
  direction: RatingDirection
) {
  const visible = ratings.filter(
    (rating) =>
      rating.subjectId === subjectId &&
      rating.direction === direction &&
      rating.visibility === 'visible'
  );
  const count = visible.length;
  const starSum = visible.reduce((sum, rating) => sum + rating.stars, 0);
  return {
    count,
    starSum,
    averageTenths: count === 0 ? null : divideRoundHalfUp(starSum * 10, count),
  };
}
