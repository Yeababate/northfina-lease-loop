import type { AssetCondition, RefurbishmentCosts } from '@/data/schemas';
import {
  LISTING_MIN_CONDITION,
  meetsCondition,
  requiredWork,
  type InspectedState,
  type RequiredAction,
  type WorkRequirements,
} from './refurbishment-rules';

type ValuationState = Pick<InspectedState, 'condition' | 'usageValue'>;
type OptionId = 'as_is' | 'to_fair' | 'to_good' | 'to_like_new';

type Option = {
  id: OptionId;
  after: ValuationState;
  work: { action: RequiredAction; costCents: number }[];
  costCents: number;
  marketValueCents: number | null;
  netValueAddedCents: number | null;
  leasable: boolean;
  missing: WorkRequirements['missing'];
  unsupported: WorkRequirements['unsupported'];
};

type Recommendation =
  | { optionId: OptionId; reason: 'best_net_value' | 'mandatory_step_only' }
  | { optionId: null; reason: 'incomplete_requirements' | 'not_worth_it_sell_or_scrap' };

/** The supplied valuation uses the inspected counter before work and the reset counter after it. */
export function decideRefurbishment(
  state: InspectedState,
  rules: RefurbishmentCosts,
  marketValue: (state: ValuationState) => number,
  minimum: 'fair' | 'good' = LISTING_MIN_CONDITION
): { marketValueBeforeCents: number; options: Option[]; recommendation: Recommendation } {
  const category = rules[state.category];
  const marketValueBeforeCents = marketValue({
    condition: state.condition,
    usageValue: state.usageValue,
  });
  const targets: { id: OptionId; condition: AssetCondition }[] = meetsCondition(
    state.condition,
    minimum
  )
    ? [{ id: 'as_is', condition: state.condition }]
    : [];
  if (minimum === 'fair' && !meetsCondition(state.condition, 'fair'))
    targets.push({ id: 'to_fair', condition: 'fair' });
  if (!meetsCondition(state.condition, 'good')) targets.push({ id: 'to_good', condition: 'good' });
  if (!meetsCondition(state.condition, 'like_new'))
    targets.push({ id: 'to_like_new', condition: 'like_new' });

  const options = targets.map(({ id, condition }): Option => {
    const { required, missing, unsupported } = requiredWork(state, rules, condition);
    const after = { condition: state.condition, usageValue: state.usageValue };
    const work = required.map((action) => {
      if (action.kind === 'upgrade') {
        after.condition = action.to;
        // requiredWork builds the path from these same upgrade keys.
        return { action, costCents: category.condition_upgrades[`${action.from}->${action.to}`]! };
      }
      if (action.resetsUsage) after.usageValue = 0;
      const rule = category.fixed.find((rule) => rule.id === action.id)!;
      return { action, costCents: rule.cost_cents * action.quantity };
    });
    // The data table and valuation already use whole euro cents. No additional rounding is needed.
    const costCents = work.reduce((total, line) => total + line.costCents, 0);
    const leasable = missing.length === 0 && unsupported.length === 0;
    const marketValueCents = leasable ? marketValue(after) : null;
    return {
      id,
      after,
      work,
      costCents,
      marketValueCents,
      netValueAddedCents:
        marketValueCents === null ? null : marketValueCents - marketValueBeforeCents - costCents,
      leasable,
      missing,
      unsupported,
    };
  });

  // Prefer lower cost on equal net value, then keep the first (least ambitious) option.
  let best: { option: Option; netValue: number } | undefined;
  for (const option of options) {
    const netValue = option.netValueAddedCents;
    if (
      netValue !== null &&
      netValue >= 0 &&
      (!best ||
        netValue > best.netValue ||
        (netValue === best.netValue && option.costCents < best.option.costCents))
    )
      best = { option, netValue };
  }

  const recommendation: Recommendation = best
    ? {
        optionId: best.option.id,
        reason: best.option.id === 'as_is' ? 'mandatory_step_only' : 'best_net_value',
      }
    : {
        optionId: null,
        reason: options.some((option) => option.leasable)
          ? 'not_worth_it_sell_or_scrap'
          : 'incomplete_requirements',
      };
  return { marketValueBeforeCents, options, recommendation };
}
