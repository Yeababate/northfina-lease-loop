// Related items: which other catalogue items to suggest next to the one being viewed.
//
// A deterministic, adjustable ruleset (data/related-item-rules.json), not a learned model.
//   1. Hard checks first. The viewed item itself, repeated ids, anything not available
//      (reserved or returned and not yet relisted), anything without a price for the same
//      lease, and anything over the customer's budget is left out. A high score can never
//      bring one of these back.
//   2. Each remaining candidate gets three 0–100 scores: category affinity, price
//      similarity and condition. The total is their weighted sum, 0–10 000.
//   3. Highest total first; equal totals in ascending asset id. Then the configured limit.
//
// Price similarity compares like with like: the caller prices every item, the viewed one
// included, as the monthly net rent for the same term with no down payment (the `basis`
// named in the rules). A list price is never compared with a monthly rent.
import type {
  Asset,
  AssetCondition,
  CoefficientTable,
  PriceList,
  RelatedItemRules,
} from '@/data/schemas';
import { listPriceOn, type PriceOverride } from './price-list';
import { quoteLease } from './pricing';
import { divideRoundHalfUp } from './rounding';

export type RelatedContext = {
  asset: Asset;
  /** The viewed item's monthly net rent on the rules' price basis, in cents. */
  monthlyNetCents: number;
  /** Optional most the customer wants to pay per month, net, in cents. */
  budgetMonthlyNetCents?: number | null;
};

export type RelatedCandidate = {
  asset: Asset;
  /** Monthly net rent on the same basis as the context, or null if it cannot be priced. */
  monthlyNetCents: number | null;
};

export type RelatedReason =
  | 'same_category'
  | 'complementary_category'
  | 'similar_monthly_price'
  | 'within_budget'
  | 'same_or_better_condition';

export type RelatedItem = {
  asset: Asset;
  monthlyNetCents: number;
  /** 0–10 000: the weighted sum of the three 0–100 scores. */
  score: number;
  reasons: RelatedReason[];
};

export type ExclusionReason =
  | 'viewed_item'
  | 'duplicate'
  | 'not_available'
  | 'cannot_be_priced'
  | 'over_budget'
  | 'unrelated_category';

export type RelatedResult = {
  items: RelatedItem[];
  excluded: { assetId: string; reason: ExclusionReason }[];
};

const CONDITION_ORDER: readonly AssetCondition[] = ['new', 'like_new', 'good', 'fair', 'poor'];

/** Ranks candidates for the viewed item. Pure: the same input always gives the same list. */
export function rankRelatedItems(
  context: RelatedContext,
  candidates: readonly RelatedCandidate[],
  rules: RelatedItemRules
): RelatedResult {
  if (!Number.isSafeInteger(context.monthlyNetCents) || context.monthlyNetCents <= 0) {
    throw new RangeError('the viewed item needs a positive monthly rent in whole cents');
  }
  const budget = context.budgetMonthlyNetCents ?? null;
  const seen = new Set<string>();
  const excluded: RelatedResult['excluded'] = [];
  const items: RelatedItem[] = [];

  for (const candidate of candidates) {
    const { asset, monthlyNetCents } = candidate;
    const exclude = (reason: ExclusionReason) => excluded.push({ assetId: asset.id, reason });
    if (asset.id === context.asset.id) {
      exclude('viewed_item');
      continue;
    }
    if (seen.has(asset.id)) {
      exclude('duplicate');
      continue;
    }
    seen.add(asset.id);
    if (asset.status !== 'available') {
      exclude('not_available');
      continue;
    }
    if (monthlyNetCents === null || !Number.isSafeInteger(monthlyNetCents)) {
      exclude('cannot_be_priced');
      continue;
    }
    if (budget !== null && monthlyNetCents > budget) {
      exclude('over_budget');
      continue;
    }
    const affinity = categoryAffinity(rules, context.asset, asset);
    if (affinity === 0) {
      exclude('unrelated_category');
      continue;
    }

    const difference = priceDifferenceBps(context.monthlyNetCents, monthlyNetCents);
    const priceScore = priceSimilarityScore(rules, difference);
    const conditionScore = rules.condition_score[asset.condition];
    const score =
      affinity * rules.weights.category +
      priceScore * rules.weights.price +
      conditionScore * rules.weights.condition;

    const reasons: RelatedReason[] = [];
    reasons.push(
      asset.category === context.asset.category ? 'same_category' : 'complementary_category'
    );
    if (difference <= rules.price.full_score_within_bps) reasons.push('similar_monthly_price');
    if (budget !== null) reasons.push('within_budget');
    if (conditionRank(asset.condition) <= conditionRank(context.asset.condition)) {
      reasons.push('same_or_better_condition');
    }
    items.push({ asset, monthlyNetCents, score, reasons });
  }

  items.sort((a, b) => b.score - a.score || compareIds(a.asset.id, b.asset.id));
  return { items: items.slice(0, rules.limit), excluded };
}

/** Affinity from the matrix; unlisted pairs use the fallback (0 by default = excluded). */
export function categoryAffinity(rules: RelatedItemRules, viewed: Asset, candidate: Asset) {
  const affinity = rules.category_affinity[viewed.category]?.[candidate.category];
  return affinity && affinity > 0 ? affinity : rules.zero_affinity_fallback;
}

/** |candidate − viewed| as basis points of the viewed rent, rounded half up once. */
export function priceDifferenceBps(viewedCents: number, candidateCents: number): number {
  return divideRoundHalfUp(Math.abs(candidateCents - viewedCents) * 10_000, viewedCents);
}

/**
 * 100 up to the full-score difference, 0 from the zero-score difference, a straight line
 * between. This is a ranking score, not money, so it is simply floored to a whole point.
 */
export function priceSimilarityScore(rules: RelatedItemRules, differenceBps: number): number {
  const { full_score_within_bps: full, zero_score_from_bps: zero } = rules.price;
  if (differenceBps <= full) return 100;
  if (differenceBps >= zero) return 0;
  return Math.floor((100 * (zero - differenceBps)) / (zero - full));
}

function conditionRank(condition: AssetCondition): number {
  return CONDITION_ORDER.indexOf(condition);
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The price basis every item is compared on: the existing quoteLease monthly net rent for
 * `termMonths` with no down payment, from the list valid on `onDate`. Null when the item
 * cannot be leased on those terms (no list price, too cheap or too expensive to finance).
 * This only reads the shared pricing; it does not calculate prices of its own.
 */
export function monthlyRentBasis(
  lists: readonly PriceList[],
  table: CoefficientTable,
  assetId: string,
  termMonths: number,
  onDate: string,
  priceOverride?: PriceOverride
): number | null {
  const price = listPriceOn(lists, assetId, onDate, priceOverride);
  if (!price.ok) return null;
  const quote = quoteLease(table, {
    listPriceCents: price.priceCents,
    downPaymentCents: 0,
    termMonths,
    vatRatePercent: 0,
  });
  return quote.ok ? quote.quote.monthlyNetCents : null;
}
