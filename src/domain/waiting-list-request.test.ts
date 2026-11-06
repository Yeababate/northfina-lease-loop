import { describe, expect, it } from 'vitest';
import {
  checkWaitingListRequest,
  conditionsUpTo,
  MAX_WAITING_BUDGET_CENTS,
} from './waiting-list-request';

const context = { today: '2026-11-06', terms: [12, 24, 36, 48] };
const request = {
  maxMonthlyNetRentCents: 9_000,
  minCondition: 'good' as const,
  preferredTermMonths: 24,
  neededBy: '2026-12-01',
};

describe('checkWaitingListRequest', () => {
  it('accepts a sensible request, including one needed today', () => {
    expect(checkWaitingListRequest(request, context)).toEqual({ ok: true });
    expect(checkWaitingListRequest({ ...request, neededBy: '2026-11-06' }, context)).toEqual({
      ok: true,
    });
  });

  it('lists every problem at once', () => {
    expect(
      checkWaitingListRequest(
        { ...request, maxMonthlyNetRentCents: 0, preferredTermMonths: 30, neededBy: '2026-11-05' },
        context
      )
    ).toEqual({ ok: false, problems: ['budget', 'term', 'needed_by'] });
  });

  it('refuses a budget that is a typo or not whole cents', () => {
    for (const cents of [MAX_WAITING_BUDGET_CENTS + 1, 12.5, -100])
      expect(
        checkWaitingListRequest({ ...request, maxMonthlyNetRentCents: cents }, context)
      ).toEqual({ ok: false, problems: ['budget'] });
  });
});

describe('conditionsUpTo', () => {
  it("offers the item's own condition and anything worse, best first", () => {
    expect(conditionsUpTo('good')).toEqual(['good', 'fair', 'poor']);
    expect(conditionsUpTo('fair')).toEqual(['fair', 'poor']);
    expect(conditionsUpTo('new')).toEqual(['new', 'like_new', 'good', 'fair', 'poor']);
    expect(conditionsUpTo('poor')).toEqual(['poor']);
  });
});
