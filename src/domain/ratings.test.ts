import { describe, expect, it } from 'vitest';
import { planRatingEdit, ratingEligibility, summarizeRatings, validateRating } from './ratings';

const contract = {
  id: 'lease',
  renterId: 'renter',
  providerId: 'provider',
  status: 'completed_return',
};

describe('rating eligibility', () => {
  it('derives both directions from the contract, including completed buyouts', () => {
    expect(ratingEligibility(contract, 'renter')).toEqual({
      ok: true,
      subjectId: 'provider',
      direction: 'renter_to_provider',
    });
    expect(ratingEligibility({ ...contract, status: 'completed_buyout' }, 'provider')).toEqual({
      ok: true,
      subjectId: 'renter',
      direction: 'provider_to_renter',
    });
  });
  it.each(['active', 'awaiting_return', 'return_received', 'awaiting_buyout', 'cancelled'])(
    'rejects %s',
    (status) => {
      expect(ratingEligibility({ ...contract, status }, 'renter')).toEqual({
        ok: false,
        reason: 'not_completed',
      });
    }
  );
  it('rejects foreign, unresolved legacy and self relationships', () => {
    expect(ratingEligibility(contract, 'stranger')).toMatchObject({ reason: 'not_participant' });
    expect(ratingEligibility({ ...contract, renterId: null }, 'provider')).toMatchObject({
      reason: 'participants_missing',
    });
    expect(ratingEligibility({ ...contract, providerId: null }, 'renter')).toMatchObject({
      reason: 'participants_missing',
    });
    expect(ratingEligibility({ ...contract, providerId: 'renter' }, 'renter')).toMatchObject({
      reason: 'self_rating',
    });
  });
});

describe('rating validation', () => {
  it('accepts boundary scores and optional trimmed plain text', () => {
    expect(validateRating(1)).toEqual({ ok: true, stars: 1, comment: '' });
    expect(validateRating(5, ' <script>plain</script> ')).toEqual({
      ok: true,
      stars: 5,
      comment: '<script>plain</script>',
    });
    expect(validateRating(3, 'x'.repeat(2000))).toMatchObject({ ok: true });
  });
  it.each([0, 6, 2.5, NaN, Infinity, '5', null])('rejects score %s', (stars) => {
    expect(validateRating(stars)).toMatchObject({ ok: false, reason: 'invalid_stars' });
  });
  it('rejects nontext and overlong comments', () => {
    expect(validateRating(4, null)).toMatchObject({ reason: 'invalid_comment' });
    expect(validateRating(4, 'x'.repeat(2001))).toMatchObject({ reason: 'comment_too_long' });
  });
});

describe('versioned edits', () => {
  const current = { reviewerId: 'author', currentRevision: 1, visibility: 'hidden' as const };
  it('preserves a moderation hold and increments the same rating revision', () => {
    expect(planRatingEdit(current, 'author', 1, 5, ' changed ')).toEqual({
      ok: true,
      stars: 5,
      comment: 'changed',
      currentRevision: 2,
      visibility: 'hidden',
    });
  });
  it('rejects a different author, stale edits, malformed revisions and invalid content', () => {
    expect(planRatingEdit(current, 'other', 1, 3)).toMatchObject({ reason: 'not_author' });
    expect(planRatingEdit(current, 'author', 2, 3)).toMatchObject({ reason: 'stale_revision' });
    for (const currentRevision of [0, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(
        planRatingEdit({ ...current, currentRevision }, 'author', currentRevision, 3)
      ).toMatchObject({ reason: 'invalid_revision' });
    }
    expect(planRatingEdit(current, 'author', 1, 8)).toMatchObject({ reason: 'invalid_stars' });
  });
});

describe('public role summaries', () => {
  const ratings = [1, 2, 2].map((stars) => ({
    subjectId: 'person',
    direction: 'renter_to_provider' as const,
    visibility: 'visible' as const,
    stars,
  }));
  it('rounds to one decimal and separates role/subject/visibility', () => {
    expect(
      summarizeRatings(
        [
          ...ratings,
          { ...ratings[0]!, visibility: 'hidden', stars: 5 },
          { ...ratings[0]!, subjectId: 'other', stars: 5 },
          { ...ratings[0]!, direction: 'provider_to_renter', stars: 5 },
        ],
        'person',
        'renter_to_provider'
      )
    ).toEqual({ count: 3, starSum: 5, averageTenths: 17 });
  });
  it('represents no ratings separately and an edit changes sum not count', () => {
    expect(summarizeRatings([], 'person', 'renter_to_provider')).toEqual({
      count: 0,
      starSum: 0,
      averageTenths: null,
    });
    expect(
      summarizeRatings([{ ...ratings[0]!, stars: 5 }], 'person', 'renter_to_provider')
    ).toEqual({ count: 1, starSum: 5, averageTenths: 50 });
  });
});
