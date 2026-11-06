// A returned item's next life (#38, #40): refurbish or not, who on the waiting list gets it,
// and at what rent. Pure: today, the data-pack rules and the waiting list are passed in.
//
// 1. Work. The required steps come from requiredWork (./refurbishment-rules.ts): fixed steps
//    (safety check, battery after a usage threshold, data wipe) are always done. Refurbishing
//    adds the condition upgrades that bring the item to the listing minimum, 'good'.
// 2. Options. "As it is" keeps the condition and can only go to someone on the waiting list who
//    accepts it; "refurbished" can be leased by anyone. An item already at 'good' has one option.
// 3. Price. Each option's next-life list price is its market value (./market-value.ts) after the
//    work; its rent is quoteLease on that price for each term, no down payment.
// 4. Match. Someone on the waiting list fits when the category matches, the condition meets
//    their minimum, their deadline has not passed, their preferred term is offered and its rent
//    is within their budget. Ties are broken by: the earliest deadline, then the longer term
//    (the item stays in use longer), then the earlier place on the list.
// 5. Decision. The option whose best match brings the most rent over the lease, minus the
//    work it costs, wins; on equal value the refurbished one. With no match, the item is
//    refurbished (when that is possible) and listed for everyone.
import type {
  AssetCategory,
  AssetCondition,
  CoefficientTable,
  RefurbishmentCosts,
  ResidualCurves,
  SecondLifeRequest,
  UsageUnit,
} from '@/data/schemas';
import { ageInMonths, marketValue } from './market-value';
import { availableTerms, quoteLease } from './pricing';
import {
  conditionRank,
  LISTING_MIN_CONDITION,
  meetsCondition,
  requiredWork,
  type RequiredAction,
} from './refurbishment-rules';

export type ReturnedItem = {
  assetId: string;
  category: AssetCategory;
  condition: AssetCondition;
  usageUnit: UsageUnit;
  usageValue: number;
  modelYear: number;
  /** The net list price the market value starts from: the earliest list price we have. */
  listPriceCents: number;
  /** Farm machines need it for the service rule; unknown elsewhere. */
  hoursSinceService: number | null;
};

export type PlannedAction = { id: string; kind: RequiredAction['kind']; costCents: number };

export type WhyNot =
  | { reason: 'over_budget'; monthlyNetCents: number }
  | { reason: 'condition_too_low' }
  | { reason: 'deadline_passed' }
  | { reason: 'term_not_offered' }
  | { reason: 'matched_elsewhere' }
  /** Fits too, but the winner came first on this tie-break rule. */
  | {
      reason: 'lost_tie_break';
      rule: 'earlier_deadline' | 'longer_term' | 'earlier_on_list';
      monthlyNetCents: number;
    };

export type WaitingListMatch = {
  requestId: string;
  who: string;
  termMonths: number;
  monthlyNetCents: number;
  neededBy: string;
};

export type NextLifeOption = {
  kind: 'as_is' | 'refurbished';
  actions: PlannedAction[];
  costCents: number;
  conditionAfter: AssetCondition;
  usageAfter: number;
  /** Next-life net list price. */
  priceCents: number;
  /** Who would get it in this option, or null. */
  match: WaitingListMatch | null;
  /** Rent over the matched lease minus the work, or null without a match. */
  valueCents: number | null;
  /** Same-category people on the list who did not fit, and why. */
  notChosen: ({ requestId: string; who: string } & WhyNot)[];
};

export type NextLifePlan =
  | {
      ok: true;
      assetId: string;
      chosen: NextLifeOption;
      /** The other option, when there was a choice to make. */
      alternative: NextLifeOption | null;
      /** The lowest condition the chosen option may be listed at. */
      listingMinimum: AssetCondition;
    }
  | { ok: false; assetId: string; reason: 'service_hours_unknown' | 'unsupported_rule' }
  /** Worth less than the smallest amount any lease finances, so it cannot be leased alone. */
  | {
      ok: false;
      assetId: string;
      reason: 'too_cheap_to_lease';
      priceCents: number;
      minimumCents: number;
    };

export type PlanContext = {
  today: string;
  rules: RefurbishmentCosts;
  curves: ResidualCurves;
  table: CoefficientTable;
  waitingList: readonly SecondLifeRequest[];
  /** Waiting-list ids already matched to another item. */
  taken?: ReadonlySet<string>;
};

export function planNextLife(item: ReturnedItem, ctx: PlanContext): NextLifePlan {
  const needs = requiredWork(
    {
      category: item.category,
      condition: item.condition,
      usageUnit: item.usageUnit,
      usageValue: item.usageValue,
      hoursSinceService: item.hoursSinceService,
    },
    ctx.rules
  );
  if (needs.missing.length > 0)
    return { ok: false, assetId: item.assetId, reason: 'service_hours_unknown' };
  if (needs.unsupported.length > 0)
    return { ok: false, assetId: item.assetId, reason: 'unsupported_rule' };

  const minimumCents = Math.min(...ctx.table.bands.map((band) => band.min_financed_cents));
  const tooCheap = (option: NextLifeOption): NextLifePlan => ({
    ok: false,
    assetId: item.assetId,
    reason: 'too_cheap_to_lease',
    priceCents: option.priceCents,
    minimumCents,
  });
  const fixed = needs.required.filter((action) => action.kind === 'fixed');
  const upgrades = needs.required.filter((action) => action.kind === 'upgrade');
  const asIs = buildOption('as_is', item, fixed, ctx);
  if (upgrades.length === 0)
    return asIs.priceCents < minimumCents
      ? tooCheap(asIs)
      : {
          ok: true,
          assetId: item.assetId,
          chosen: asIs,
          alternative: null,
          listingMinimum: LISTING_MIN_CONDITION,
        };

  const refurbished = buildOption('refurbished', item, [...fixed, ...upgrades], ctx);
  if (refurbished.priceCents < minimumCents && asIs.match === null) return tooCheap(refurbished);
  const asIsWins =
    asIs.valueCents !== null &&
    (refurbished.valueCents === null || asIs.valueCents > refurbished.valueCents);
  return asIsWins && asIs.match
    ? {
        ok: true,
        assetId: item.assetId,
        chosen: asIs,
        alternative: refurbished,
        listingMinimum: lowestAccepted(asIs.conditionAfter, ctx.waitingList, asIs.match.requestId),
      }
    : {
        ok: true,
        assetId: item.assetId,
        chosen: refurbished,
        alternative: asIs,
        listingMinimum: LISTING_MIN_CONDITION,
      };
}

/**
 * Plans several returned items in order, so one person on the waiting list is matched to at
 * most one item. Earlier items in `items` get the first pick.
 */
export function planNextLives(
  items: readonly ReturnedItem[],
  ctx: Omit<PlanContext, 'taken'>
): NextLifePlan[] {
  const taken = new Set<string>();
  return items.map((item) => {
    const plan = planNextLife(item, { ...ctx, taken });
    if (plan.ok && plan.chosen.match) taken.add(plan.chosen.match.requestId);
    return plan;
  });
}

function buildOption(
  kind: NextLifeOption['kind'],
  item: ReturnedItem,
  actions: readonly RequiredAction[],
  ctx: PlanContext
): NextLifeOption {
  const costs = ctx.rules[item.category];
  const planned: PlannedAction[] = actions.map((action) => ({
    id: action.id,
    kind: action.kind,
    costCents:
      action.kind === 'fixed'
        ? (costs.fixed.find((rule) => rule.id === action.id)?.cost_cents ?? 0) * action.quantity
        : (costs.condition_upgrades[`${action.from}->${action.to}`] ?? 0),
  }));
  const conditionAfter = actions.reduce<AssetCondition>(
    (condition, action) =>
      action.kind === 'upgrade' && conditionRank(action.to) > conditionRank(condition)
        ? action.to
        : condition,
    item.condition
  );
  const resets = actions.some((action) => action.kind === 'fixed' && action.resetsUsage);
  const usageAfter = resets ? 0 : item.usageValue;
  const priceCents = marketValue(
    {
      category: item.category,
      condition: conditionAfter,
      usageValue: usageAfter,
      listPriceCents: item.listPriceCents,
      ageMonths: ageInMonths(item.modelYear, ctx.today),
    },
    ctx.curves
  ).valueCents;
  const costCents = planned.reduce((sum, action) => sum + action.costCents, 0);
  const { match, notChosen } = matchWaitingList(item.category, conditionAfter, priceCents, ctx);
  return {
    kind,
    actions: planned,
    costCents,
    conditionAfter,
    usageAfter,
    priceCents,
    match,
    valueCents: match ? match.monthlyNetCents * match.termMonths - costCents : null,
    notChosen,
  };
}

/** The best fit on the waiting list for an item in this state, and why the others lost. */
export function matchWaitingList(
  category: AssetCategory,
  condition: AssetCondition,
  priceCents: number,
  ctx: PlanContext
): { match: WaitingListMatch | null; notChosen: NextLifeOption['notChosen'] } {
  const terms = availableTerms(ctx.table);
  const fits: { request: SecondLifeRequest; index: number; monthlyNetCents: number }[] = [];
  const notChosen: NextLifeOption['notChosen'] = [];
  ctx.waitingList.forEach((request, index) => {
    if (request.category !== category) return;
    const base = { requestId: request.id, who: request.who };
    if (ctx.taken?.has(request.id)) return notChosen.push({ ...base, reason: 'matched_elsewhere' });
    if (request.needed_by < ctx.today)
      return notChosen.push({ ...base, reason: 'deadline_passed' });
    if (!meetsCondition(condition, request.min_condition))
      return notChosen.push({ ...base, reason: 'condition_too_low' });
    if (!terms.includes(request.preferred_term_months))
      return notChosen.push({ ...base, reason: 'term_not_offered' });
    const quote = quoteLease(ctx.table, {
      listPriceCents: priceCents,
      downPaymentCents: 0,
      termMonths: request.preferred_term_months,
      vatRatePercent: 0,
    });
    if (!quote.ok) return notChosen.push({ ...base, reason: 'term_not_offered' });
    if (quote.quote.monthlyNetCents > request.max_monthly_net_rent_cents)
      return notChosen.push({
        ...base,
        reason: 'over_budget',
        monthlyNetCents: quote.quote.monthlyNetCents,
      });
    fits.push({ request, index, monthlyNetCents: quote.quote.monthlyNetCents });
  });

  fits.sort(
    (a, b) =>
      a.request.needed_by.localeCompare(b.request.needed_by) ||
      b.request.preferred_term_months - a.request.preferred_term_months ||
      a.index - b.index
  );
  const [best, ...rest] = fits;
  if (best) {
    for (const runnerUp of rest.toReversed()) {
      notChosen.unshift({
        requestId: runnerUp.request.id,
        who: runnerUp.request.who,
        reason: 'lost_tie_break',
        rule:
          best.request.needed_by !== runnerUp.request.needed_by
            ? 'earlier_deadline'
            : best.request.preferred_term_months !== runnerUp.request.preferred_term_months
              ? 'longer_term'
              : 'earlier_on_list',
        monthlyNetCents: runnerUp.monthlyNetCents,
      });
    }
  }
  return {
    match: best
      ? {
          requestId: best.request.id,
          who: best.request.who,
          termMonths: best.request.preferred_term_months,
          monthlyNetCents: best.monthlyNetCents,
          neededBy: best.request.needed_by,
        }
      : null,
    notChosen,
  };
}

function lowestAccepted(
  condition: AssetCondition,
  waitingList: readonly SecondLifeRequest[],
  requestId: string
): AssetCondition {
  const request = waitingList.find((entry) => entry.id === requestId);
  return request && meetsCondition(condition, request.min_condition)
    ? request.min_condition
    : LISTING_MIN_CONDITION;
}
