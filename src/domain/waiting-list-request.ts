// "Join the waiting list" (a customer asks for a used item like one they cannot lease now).
// The request goes into the same list the second-life matching ranks (./matchmaking.ts), so
// it must make sense for that: a budget, the worst condition accepted, an offered lease
// length, and a date that is not in the past.
import type { AssetCondition } from '@/data/schemas';

/** €10,000 a month: anything above is a typo, not a budget. */
export const MAX_WAITING_BUDGET_CENTS = 1_000_000;

export type WaitingListRequestInput = {
  maxMonthlyNetRentCents: number;
  minCondition: AssetCondition;
  preferredTermMonths: number;
  neededBy: string;
};

export type WaitingListProblem = 'budget' | 'term' | 'needed_by';

export function checkWaitingListRequest(
  input: WaitingListRequestInput,
  context: { today: string; terms: readonly number[] }
): { ok: true } | { ok: false; problems: WaitingListProblem[] } {
  const problems: WaitingListProblem[] = [];
  if (
    !Number.isSafeInteger(input.maxMonthlyNetRentCents) ||
    input.maxMonthlyNetRentCents <= 0 ||
    input.maxMonthlyNetRentCents > MAX_WAITING_BUDGET_CENTS
  )
    problems.push('budget');
  if (!context.terms.includes(input.preferredTermMonths)) problems.push('term');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.neededBy) || input.neededBy < context.today)
    problems.push('needed_by');
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
