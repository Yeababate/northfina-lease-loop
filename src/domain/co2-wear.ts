// Wear credit: how much of a new item's manufacturing footprint a rental of THIS item is
// credited with, from 0 (worn out) to 1 (as good as new). A worn item gets less credit.
//
// The policy is data, built here from residual-curves.json as a PRICE-DERIVED PROXY: the
// condition multipliers and the capped usage penalties that set a used item's market value.
// That is not a measured remaining useful life and not a scientific CO2 factor. The policy is
// copied into its own object, so later changes to pricing data or pricing code cannot change
// the impact estimate by accident, and a different wear policy can replace this one without
// touching the estimator or the UI.
//
// Rounding: the credit is held in whole parts per million (ppm) and rounded once, half up,
// when the condition credit and the usage penalty are combined.
import type {
  Asset,
  AssetCategory,
  AssetCondition,
  ResidualCurves,
  UsageUnit,
} from '@/data/schemas';
import { PPM } from './co2-factors';
import { divideRoundHalfUp, toScaledInteger } from './rounding';

export type UsagePenaltyRule = {
  unit: UsageUnit;
  /** Completed steps of `step` units each reduce the credit by `penaltyPerStepPpm`. */
  step: number;
  penaltyPerStepPpm: number;
  /** The total usage penalty never goes beyond this. */
  maxPenaltyPpm: number;
};

/** What to do when a counter was reset and the usage before the reset is not known. */
export type UnknownPriorUsageRule = 'max_penalty';

export type WearPolicy = {
  id: string;
  version: number;
  basis: 'price_derived_proxy';
  conditionCreditPpm: Record<AssetCondition, number>;
  usagePenalty: Partial<Record<AssetCategory, UsagePenaltyRule>>;
  unknownPriorUsage: UnknownPriorUsageRule;
};

/**
 * What we know about the usage counter's history. Seed data records no counter resets, so
 * the caller says `no_reset_recorded` and the estimate states the assumption that the counter
 * shows lifetime usage. A reset (new battery, engine overhaul) never makes an old item look
 * unused: known usage before the reset is added, unknown usage counts as the maximum penalty.
 */
export type UsageHistory =
  | { kind: 'no_reset_recorded' }
  | { kind: 'reset_with_known_prior'; priorUsage: number }
  | { kind: 'reset_unknown_prior' };

export type WearInput = {
  category: AssetCategory;
  condition: AssetCondition;
  usage: Asset['usage'];
  history: UsageHistory;
};

export type WearCredit = {
  /** The final credit, 0..1 000 000 ppm. */
  creditPpm: number;
  conditionCreditPpm: number;
  usagePenaltyPpm: number;
  /** Usage the penalty was based on, or null when prior usage is unknown. */
  effectiveUsage: number | null;
  usageUnit: UsageUnit;
  penaltyCapped: boolean;
  history: UsageHistory['kind'];
};

export type WearCreditResult =
  | { ok: true; wear: WearCredit }
  | { ok: false; reason: 'no_wear_rule' | 'usage_unit_mismatch' | 'invalid_usage' };

export type BuildWearPolicyResult =
  { ok: true; policy: WearPolicy } | { ok: false; reason: 'invalid_wear_data'; field: string };

/** The id/version of the residual-curve proxy policy. */
export const RESIDUAL_PROXY_WEAR_POLICY = { id: 'residual-proxy', version: 1 } as const;

/** Builds the default wear policy from the residual-value data (a price-derived proxy). */
export function buildResidualProxyWearPolicy(residual: ResidualCurves): BuildWearPolicyResult {
  const conditionCreditPpm = {} as Record<AssetCondition, number>;
  for (const [condition, multiplier] of Object.entries(residual.condition_multiplier)) {
    const ppm = scaled(multiplier, PPM);
    if (ppm === null || ppm > PPM) {
      return { ok: false, reason: 'invalid_wear_data', field: `condition.${condition}` };
    }
    conditionCreditPpm[condition as AssetCondition] = ppm;
  }

  const usagePenalty: Partial<Record<AssetCategory, UsagePenaltyRule>> = {};
  for (const [category, rule] of Object.entries(residual.usage_adjustment)) {
    // Percent → ppm is ×10 000. Data stores losses as negative percentages; a positive value
    // would mean usage INCREASES credit, which this policy does not allow.
    const perStep = rule.percent_per_step <= 0 ? scaled(-rule.percent_per_step, 10_000) : null;
    const max = rule.max_total_percent <= 0 ? scaled(-rule.max_total_percent, 10_000) : null;
    if (perStep === null || max === null || max > PPM || !isPositive(rule.step)) {
      return { ok: false, reason: 'invalid_wear_data', field: `usage.${category}` };
    }
    usagePenalty[category as AssetCategory] = {
      unit: rule.unit,
      step: rule.step,
      penaltyPerStepPpm: perStep,
      maxPenaltyPpm: max,
    };
  }

  return {
    ok: true,
    policy: {
      ...RESIDUAL_PROXY_WEAR_POLICY,
      basis: 'price_derived_proxy',
      conditionCreditPpm,
      usagePenalty,
      unknownPriorUsage: 'max_penalty',
    },
  };
}

/**
 * credit = condition credit × (1 − usage penalty), bounded to 0..1.
 * The usage penalty counts completed steps only (999 km is 0 steps of 1000 km) and is capped.
 */
export function calculateWearCredit(input: WearInput, policy: WearPolicy): WearCreditResult {
  const rule = policy.usagePenalty[input.category];
  const conditionPpm = policy.conditionCreditPpm[input.condition];
  if (!rule || conditionPpm === undefined) return { ok: false, reason: 'no_wear_rule' };
  if (rule.unit !== input.usage.unit) return { ok: false, reason: 'usage_unit_mismatch' };
  if (!isCount(input.usage.value)) return { ok: false, reason: 'invalid_usage' };

  let effectiveUsage: number | null;
  if (input.history.kind === 'reset_unknown_prior') {
    effectiveUsage = null;
  } else if (input.history.kind === 'reset_with_known_prior') {
    if (!isCount(input.history.priorUsage)) return { ok: false, reason: 'invalid_usage' };
    effectiveUsage = input.usage.value + input.history.priorUsage;
  } else {
    effectiveUsage = input.usage.value;
  }

  const uncapped =
    effectiveUsage === null
      ? rule.maxPenaltyPpm
      : Math.floor(effectiveUsage / rule.step) * rule.penaltyPerStepPpm;
  const usagePenaltyPpm = Math.min(uncapped, rule.maxPenaltyPpm, PPM);
  const condition = clampPpm(conditionPpm);
  const creditPpm = clampPpm(divideRoundHalfUp(condition * (PPM - usagePenaltyPpm), PPM));

  return {
    ok: true,
    wear: {
      creditPpm,
      conditionCreditPpm: condition,
      usagePenaltyPpm,
      effectiveUsage,
      usageUnit: rule.unit,
      penaltyCapped: effectiveUsage !== null && uncapped >= rule.maxPenaltyPpm,
      history: input.history.kind,
    },
  };
}

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clampPpm(value: number): number {
  return Math.min(PPM, Math.max(0, value));
}

function scaled(value: number, scale: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  try {
    return toScaledInteger(value, scale);
  } catch {
    return null;
  }
}
