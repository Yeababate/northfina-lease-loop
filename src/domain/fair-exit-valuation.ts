// What the returned item(s) of an early return are worth on the exit date: the market-value
// credit of the fair-exit-v2 return price (fair-exit.ts). Valuation itself is market-value.ts
// (#39): first-lease list price × residual curve(age) × condition × usage, rounded once per item.
//
// DEFAULT BEFORE INSPECTION: the quote is given while the renter still has the item, so nobody
// has inspected it since it was leased out. The recorded usage is used as is, but the condition
// is capped at `good` (LISTING_MIN_CONDITION): a used item is not credited as new or like new
// on the renter's word. When an inspection exists, its condition and usage are used instead.
import type { AssetCategory, AssetCondition, ResidualCurves, UsageUnit } from '@/data/schemas';
import { marketAgeMonths, marketValueCents } from './market-value';
import { conditionRank, LISTING_MIN_CONDITION } from './refurbishment-rules';

export const ASSUMED_CONDITION_CAP: AssetCondition = LISTING_MIN_CONDITION;

export type ReturnedItem = Readonly<{
  assetId: string;
  category: AssetCategory;
  modelYear: number;
  /** Condition and usage recorded on the item (when it was leased out). */
  recordedCondition: AssetCondition;
  usage: Readonly<{ unit: UsageUnit; value: number }>;
  /** Latest inspection since it was leased out, or null. */
  inspection: Readonly<{ condition: AssetCondition; usageValue: number }> | null;
  firstLeaseStartOn: string | null;
  firstLeaseListPriceCents: number;
}>;

export type ValuedItem = {
  assetId: string;
  basis: 'inspected' | 'assumed';
  condition: AssetCondition;
  usageUnit: UsageUnit;
  usageValue: number;
  ageMonths: number;
  marketValueCents: number;
};

export type ReturnValuation =
  | { ok: true; marketValueCents: number; items: ValuedItem[] }
  | { ok: false; reason: 'market_value_unavailable' };

/** The condition and usage valued: inspected if known, otherwise the cautious default. */
export function valuedState(item: ReturnedItem) {
  if (item.inspection) {
    return {
      basis: 'inspected' as const,
      condition: item.inspection.condition,
      usageValue: item.inspection.usageValue,
    };
  }
  const capped =
    conditionRank(item.recordedCondition) > conditionRank(ASSUMED_CONDITION_CAP)
      ? ASSUMED_CONDITION_CAP
      : item.recordedCondition;
  return { basis: 'assumed' as const, condition: capped, usageValue: item.usage.value };
}

/** Values every returned item on `on` (the exit date) and adds them up, in cents. */
export function valueReturnedItems(
  items: readonly ReturnedItem[],
  on: string,
  curves: ResidualCurves
): ReturnValuation {
  if (items.length === 0) return { ok: false, reason: 'market_value_unavailable' };
  const valued: ValuedItem[] = [];
  for (const item of items) {
    const state = valuedState(item);
    const ageMonths = marketAgeMonths(item.firstLeaseStartOn, item.modelYear, on);
    const value = marketValueCents(
      {
        category: item.category,
        condition: state.condition,
        usage: { unit: item.usage.unit, value: state.usageValue },
        firstLeaseListPriceCents: item.firstLeaseListPriceCents,
        ageMonths,
      },
      curves
    );
    if (!value.ok) return { ok: false, reason: 'market_value_unavailable' };
    valued.push({
      assetId: item.assetId,
      ...state,
      usageUnit: item.usage.unit,
      ageMonths,
      marketValueCents: value.priceCents,
    });
  }
  return {
    ok: true,
    marketValueCents: valued.reduce((sum, item) => sum + item.marketValueCents, 0),
    items: valued,
  };
}
