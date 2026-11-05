// CO2 factor sets for the circular-impact estimate.
//
// A factor set is versioned DATA, kept apart from the formula in co2-impact.ts. Replacing the
// fictional hackathon numbers with sourced ones later means building a new factor set with a
// new id/version and source metadata; the estimator and the UI do not change, and estimates
// already shown keep the factor set version they were computed with.
//
// Units: everything is converted to whole grams of CO2e (g CO2e) and shares to parts per
// million (ppm), so the estimator multiplies integers only. The conversion refuses values
// with more precision than a gram or a ppm instead of silently rounding them.
import type { AssetCategory, Co2Factors } from '@/data/schemas';
import { toScaledInteger } from './rounding';

/** 1 = 1 000 000 ppm. */
export const PPM = 1_000_000;
/** Grams per kilogram. */
export const GRAMS_PER_KG = 1000;

/** How trustworthy the numbers are. Only `fictional_illustrative` exists today. */
export type FactorSetStatus = 'fictional_illustrative' | 'sourced';

export type Co2FactorSet = {
  id: string;
  version: number;
  status: FactorSetStatus;
  unit: 'g_co2e';
  /** Where the numbers came from, for the explanation and for later audits. */
  sourceReference: string;
  /** The source's own caveat, kept verbatim. */
  sourceNote: string;
  /** Grams of CO2e to manufacture one new item, by category. A missing category = no factor. */
  manufacturingNewGrams: Partial<Record<AssetCategory, number>>;
  /** Refurbishing an item for its next life costs this share of a new one, in ppm. */
  refurbishmentShareOfNewPpm: number;
  /**
   * Grams of CO2e per km cycled instead of driven. Kept for completeness but NOT used by the
   * current method: we have no facts about what a renter would otherwise have driven.
   */
  carDisplacementGramsPerKm: number;
};

export type BuildFactorSetResult =
  { ok: true; factorSet: Co2FactorSet } | { ok: false; reason: 'invalid_factor'; field: string };

/** The id/version of the supplied fictional hackathon factors (data/co2-factors.json). */
export const HACKATHON_FACTOR_SET = { id: 'hackathon-fictional', version: 1 } as const;

/**
 * Wraps data/co2-factors.json in explicit metadata. The values are fictional, so the set is
 * marked `fictional_illustrative`; the UI must label every estimate from it as illustrative.
 */
export function buildFactorSet(
  factors: Co2Factors,
  meta: { id: string; version: number; status: FactorSetStatus; sourceReference: string }
): BuildFactorSetResult {
  const manufacturingNewGrams: Partial<Record<AssetCategory, number>> = {};
  for (const [category, kg] of Object.entries(factors.manufacturing_new_kg)) {
    const grams = toWhole(kg, GRAMS_PER_KG);
    if (grams === null) return { ok: false, reason: 'invalid_factor', field: category };
    manufacturingNewGrams[category as AssetCategory] = grams;
  }

  const sharePpm = toWhole(factors.refurbishment_share_of_new, PPM);
  if (sharePpm === null || sharePpm > PPM) {
    return { ok: false, reason: 'invalid_factor', field: 'refurbishment_share_of_new' };
  }
  const carGrams = toWhole(factors.e_bike_avoided_car_km_kg_per_km, GRAMS_PER_KG);
  if (carGrams === null) {
    return { ok: false, reason: 'invalid_factor', field: 'e_bike_avoided_car_km_kg_per_km' };
  }

  return {
    ok: true,
    factorSet: {
      ...meta,
      unit: 'g_co2e',
      sourceNote: factors.note,
      manufacturingNewGrams,
      refurbishmentShareOfNewPpm: sharePpm,
      carDisplacementGramsPerKm: carGrams,
    },
  };
}

/** The supplied hackathon factors as factor set `hackathon-fictional` v1. */
export function buildHackathonFactorSet(factors: Co2Factors): BuildFactorSetResult {
  return buildFactorSet(factors, {
    ...HACKATHON_FACTOR_SET,
    status: 'fictional_illustrative',
    sourceReference: 'data/co2-factors.json (Lease Loop hackathon data pack)',
  });
}

/** A finite, non-negative value as whole `1/scale` units, or null when that would lose digits. */
function toWhole(value: number, scale: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  try {
    const whole = toScaledInteger(value, scale);
    return Number.isSafeInteger(whole) ? whole : null;
  } catch {
    return null;
  }
}
