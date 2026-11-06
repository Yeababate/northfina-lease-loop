import type { AssetCategory, CoefficientTable, SecondLifeRequest } from '@/data/schemas';
import { quoteLease } from './pricing';
import { refurbishmentIsWorthIt, type decideRefurbishment } from './refurbish-decision';
import { meetsCondition } from './refurbishment-rules';

type Option = ReturnType<typeof decideRefurbishment>['options'][number];
export type WaitingEntry = SecondLifeRequest & {
  status: 'waiting' | 'offered' | 'matched' | 'expired';
};
type RejectReason =
  | 'wrong_category'
  | 'deadline_passed'
  | 'not_ready_in_time'
  | 'not_waiting'
  | 'condition_too_low'
  | 'refurbishment_not_worth_it'
  | 'unfinanceable'
  | 'over_budget';
type Offer = {
  entry: WaitingEntry;
  option: Option;
  monthlyNetCents: number;
  monthlyGrossCents: number;
};

/** Earliest deadline wins, then the offer needing less work, earliest sign-up, and finally id. */
export function rankWaitingList(
  item: { category: AssetCategory; readyOn: string },
  options: readonly Option[],
  entries: readonly WaitingEntry[],
  today: string,
  table: CoefficientTable,
  vatRatePercent: number
) {
  const ranked: Offer[] = [];
  const rejected: { entryId: string; reason: RejectReason }[] = [];
  for (const entry of entries) {
    const result = offerFor(entry, item, options, today, table, vatRatePercent);
    if (typeof result === 'string') rejected.push({ entryId: entry.id, reason: result });
    else ranked.push(result);
  }
  ranked.sort(
    (a, b) =>
      a.entry.needed_by.localeCompare(b.entry.needed_by) ||
      a.option.costCents - b.option.costCents ||
      a.entry.signed_up_on.localeCompare(b.entry.signed_up_on) ||
      a.entry.id.localeCompare(b.entry.id)
  );
  const winner = ranked[0];
  return {
    ranked: ranked.map((offer) => ({
      ...offer,
      qualifies: ['category_match', 'condition_met', 'within_budget', 'ready_in_time'] as const,
      rankReason:
        winner === offer
          ? ranked[1]
            ? rankReason(offer, ranked[1])
            : 'only_eligible'
          : rankReason(winner!, offer),
    })),
    rejected,
  };
}

function rankReason(higher: Offer, lower: Offer) {
  if (higher.entry.needed_by !== lower.entry.needed_by) return 'earlier_deadline';
  if (higher.option.costCents !== lower.option.costCents) return 'less_refurbishment';
  if (higher.entry.signed_up_on !== lower.entry.signed_up_on) return 'earlier_sign_up';
  return 'entry_id';
}

function offerFor(
  entry: WaitingEntry,
  item: { category: AssetCategory; readyOn: string },
  options: readonly Option[],
  today: string,
  table: CoefficientTable,
  vatRatePercent: number
): Offer | RejectReason {
  if (entry.category !== item.category) return 'wrong_category';
  if (entry.needed_by < today) return 'deadline_passed';
  if (entry.status !== 'waiting') return 'not_waiting';
  if (item.readyOn > entry.needed_by) return 'not_ready_in_time';
  let rejection: RejectReason = 'condition_too_low';
  let best: Offer | undefined;
  for (const option of options) {
    if (!option.leasable || !meetsCondition(option.after.condition, entry.min_condition)) continue;
    if (!refurbishmentIsWorthIt(option, options) || option.marketValueCents === null) {
      if (rejection === 'condition_too_low') rejection = 'refurbishment_not_worth_it';
      continue;
    }
    const result = quoteLease(table, {
      listPriceCents: option.marketValueCents,
      downPaymentCents: 0,
      termMonths: entry.preferred_term_months,
      vatRatePercent,
    });
    if (!result.ok) {
      if (rejection !== 'over_budget') rejection = 'unfinanceable';
      continue;
    }
    if (result.quote.monthlyNetCents > entry.max_monthly_net_rent_cents) {
      rejection = 'over_budget';
      continue;
    }
    if (!best || option.costCents < best.option.costCents)
      best = {
        entry,
        option,
        monthlyNetCents: result.quote.monthlyNetCents,
        monthlyGrossCents: result.quote.monthlyGrossCents,
      };
  }
  return best ?? rejection;
}
