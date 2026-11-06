// Prospective "renting instead of buying new" CO2 estimate. ILLUSTRATIVE, not measured.
//
// Method `prospective-circular-use` v1 (the same for new and used items):
//
//   credited manufacturing = new-item manufacturing footprint × wear credit
//   refurbishment allowance = new-item manufacturing footprint × refurbishment share
//   estimated saving        = credited manufacturing − refurbishment allowance
//
// The allowance stands for the refurbishment this circular-use scenario needs before the
// item's next life. It is a hypothetical factor, not a recorded work event, and it does not
// shrink with wear. No car-displacement (travel) credit is given: we have no facts about what
// a renter would otherwise drive. The chosen term is part of the interface, but this simple
// method does not allocate impact by duration, so the term does not change the result.
//
// First use (no previous lives) uses the same method by default: the estimate describes a
// prospective scenario where this item keeps circulating, not avoided past manufacturing.
// The method's `firstUse` setting can change that treatment in one place.
//
// Rounding: each component is rounded ONCE to whole grams, half up, from an exact integer
// product (grams × ppm / 1 000 000). The saving is the exact difference of the two rounded
// components, so the breakdown always adds up. Results may be zero or negative and are kept.
import type { Asset } from '@/data/schemas';
import { PPM, type Co2FactorSet, type FactorSetStatus } from './co2-factors';
import {
  calculateWearCredit,
  type UsageHistory,
  type WearCredit,
  type WearPolicy,
} from './co2-wear';
import { divideRoundHalfUp } from './rounding';

export type FirstUseTreatment =
  { treatment: 'same_as_reuse' } | { treatment: 'scaled_credit'; creditScalePpm: number };

export type ImpactMethod = { id: string; version: number; firstUse: FirstUseTreatment };

export const DEFAULT_IMPACT_METHOD: ImpactMethod = {
  id: 'prospective-circular-use',
  version: 1,
  firstUse: { treatment: 'same_as_reuse' },
};

export type ImpactAsset = Pick<Asset, 'category' | 'condition' | 'usage'>;

/** What we know about the item's past. `previousLives` comes from the asset record. */
export type KnownHistory = { previousLives: number; usage: UsageHistory };

export type ImpactEstimateInput = {
  asset: ImpactAsset;
  termMonths: number;
  knownHistory: KnownHistory;
  factors: Co2FactorSet;
  wearPolicy: WearPolicy;
  method: ImpactMethod;
};

export type ImpactVersions = {
  factorSetId: string;
  factorSetVersion: number;
  factorSetStatus: FactorSetStatus;
  wearPolicyId: string;
  wearPolicyVersion: number;
  methodId: string;
  methodVersion: number;
};

/** Short codes the UI turns into translated assumption sentences. */
export type ImpactAssumption =
  | 'fictional_factors'
  | 'sourced_factors'
  | 'not_measured'
  | 'compared_with_new'
  | 'wear_price_proxy'
  | 'refurbishment_hypothetical'
  | 'term_not_allocated'
  | 'no_travel_credit'
  | 'first_use_future_circulation'
  | 'first_use_scaled'
  | 'reuse_previous_lives'
  | 'counter_assumed_lifetime'
  | 'counter_reset_prior_added'
  | 'counter_reset_prior_unknown';

export type ImpactEstimate = {
  estimatedSavingGrams: number;
  outcome: 'saving' | 'no_saving' | 'additional_impact';
  manufacturingBaselineGrams: number;
  creditedManufacturingGrams: number;
  refurbishmentAllowanceGrams: number;
  /** The credit actually applied (after any first-use treatment), ppm. */
  appliedCreditPpm: number;
  wear: WearCredit;
  refurbishmentShareOfNewPpm: number;
  context: 'first_use' | 'reuse';
  previousLives: number;
  termMonths: number;
  versions: ImpactVersions;
  assumptions: ImpactAssumption[];
};

export type ImpactUnavailableReason =
  | 'invalid_term'
  | 'invalid_history'
  | 'no_factor'
  | 'no_wear_rule'
  | 'usage_unit_mismatch'
  | 'invalid_usage'
  | 'invalid_method';

export type ImpactEstimateResult =
  | { ok: true; estimate: ImpactEstimate }
  | { ok: false; reason: ImpactUnavailableReason; versions: ImpactVersions };

export function estimateRentalCo2Saving(input: ImpactEstimateInput): ImpactEstimateResult {
  const { asset, knownHistory, factors, method } = input;
  const versions = versionsOf(input);
  const unavailable = (reason: ImpactUnavailableReason): ImpactEstimateResult => ({
    ok: false,
    reason,
    versions,
  });

  if (!Number.isSafeInteger(input.termMonths) || input.termMonths <= 0) {
    return unavailable('invalid_term');
  }
  if (!Number.isSafeInteger(knownHistory.previousLives) || knownHistory.previousLives < 0) {
    return unavailable('invalid_history');
  }
  const baseline = factors.manufacturingNewGrams[asset.category];
  const sharePpm = factors.refurbishmentShareOfNewPpm;
  if (!isGrams(baseline) || !Number.isSafeInteger(sharePpm) || sharePpm < 0 || sharePpm > PPM) {
    return unavailable('no_factor');
  }

  const wear = calculateWearCredit(
    {
      category: asset.category,
      condition: asset.condition,
      usage: asset.usage,
      history: knownHistory.usage,
    },
    input.wearPolicy
  );
  if (!wear.ok) return unavailable(wear.reason);

  const context = knownHistory.previousLives === 0 ? 'first_use' : 'reuse';
  const applied = appliedCredit(wear.wear.creditPpm, context, method.firstUse);
  if (applied === null) return unavailable('invalid_method');

  const credited = divideRoundHalfUp(baseline * applied, PPM);
  const allowance = divideRoundHalfUp(baseline * sharePpm, PPM);
  const saving = credited - allowance;

  return {
    ok: true,
    estimate: {
      estimatedSavingGrams: saving,
      outcome: saving > 0 ? 'saving' : saving === 0 ? 'no_saving' : 'additional_impact',
      manufacturingBaselineGrams: baseline,
      creditedManufacturingGrams: credited,
      refurbishmentAllowanceGrams: allowance,
      appliedCreditPpm: applied,
      wear: wear.wear,
      refurbishmentShareOfNewPpm: sharePpm,
      context,
      previousLives: knownHistory.previousLives,
      termMonths: input.termMonths,
      versions,
      assumptions: assumptionsFor(factors.status, context, method.firstUse, knownHistory.usage),
    },
  };
}

/** Builds what we know from an asset record. No reset records exist in the data pack. */
export function knownHistoryFromAsset(asset: Pick<Asset, 'previous_lives'>): KnownHistory {
  return { previousLives: asset.previous_lives, usage: { kind: 'no_reset_recorded' } };
}

export type CombinedEstimate = {
  totalSavingGrams: number;
  estimatedCount: number;
  unavailableCount: number;
  /** True when at least one line has no estimate: the total does not cover the whole package. */
  partial: boolean;
};

/** Sums the gram outputs of several estimates (one per item). Missing lines are counted, not zeroed. */
export function combineEstimates(results: readonly ImpactEstimateResult[]): CombinedEstimate {
  let total = 0;
  let estimated = 0;
  for (const result of results) {
    if (!result.ok) continue;
    total += result.estimate.estimatedSavingGrams;
    estimated += 1;
  }
  const unavailable = results.length - estimated;
  return {
    totalSavingGrams: total,
    estimatedCount: estimated,
    unavailableCount: unavailable,
    partial: unavailable > 0,
  };
}

function appliedCredit(
  creditPpm: number,
  context: 'first_use' | 'reuse',
  firstUse: FirstUseTreatment
): number | null {
  if (context === 'reuse' || firstUse.treatment === 'same_as_reuse') return creditPpm;
  const scale = firstUse.creditScalePpm;
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > PPM) return null;
  return divideRoundHalfUp(creditPpm * scale, PPM);
}

function assumptionsFor(
  status: FactorSetStatus,
  context: 'first_use' | 'reuse',
  firstUse: FirstUseTreatment,
  usage: UsageHistory
): ImpactAssumption[] {
  const list: ImpactAssumption[] = [
    status === 'fictional_illustrative' ? 'fictional_factors' : 'sourced_factors',
    'not_measured',
    'compared_with_new',
    'wear_price_proxy',
    'refurbishment_hypothetical',
  ];
  if (context === 'first_use') {
    list.push('first_use_future_circulation');
    if (firstUse.treatment === 'scaled_credit') list.push('first_use_scaled');
  } else {
    list.push('reuse_previous_lives');
  }
  list.push(
    usage.kind === 'no_reset_recorded'
      ? 'counter_assumed_lifetime'
      : usage.kind === 'reset_with_known_prior'
        ? 'counter_reset_prior_added'
        : 'counter_reset_prior_unknown'
  );
  list.push('term_not_allocated', 'no_travel_credit');
  return list;
}

function versionsOf(input: ImpactEstimateInput): ImpactVersions {
  return {
    factorSetId: input.factors.id,
    factorSetVersion: input.factors.version,
    factorSetStatus: input.factors.status,
    wearPolicyId: input.wearPolicy.id,
    wearPolicyVersion: input.wearPolicy.version,
    methodId: input.method.id,
    methodVersion: input.method.version,
  };
}

/** Largest footprint whose product with a ppm share is still an exact integer (≈ 9 000 t). */
const MAX_GRAMS = Math.floor(Number.MAX_SAFE_INTEGER / PPM);

function isGrams(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 && value <= MAX_GRAMS;
}
