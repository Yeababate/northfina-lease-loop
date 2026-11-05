// Read adapter for the illustrative CO2 estimate. Loads the versioned factor set and wear
// policy from the data pack and passes them, with the asset and chosen term, to the pure
// estimator in src/domain/co2-impact.ts. Read-only: it posts nothing and stores nothing.
// No remote carbon API: every number comes from data/ and the documented formula.
import { loadCo2Factors, loadResidualCurves } from '@/data/load';
import type { Asset } from '@/data/schemas';
import { buildHackathonFactorSet, type Co2FactorSet } from '@/domain/co2-factors';
import {
  DEFAULT_IMPACT_METHOD,
  estimateRentalCo2Saving,
  knownHistoryFromAsset,
  type ImpactEstimateResult,
  type ImpactMethod,
} from '@/domain/co2-impact';
import { buildResidualProxyWearPolicy, type WearPolicy } from '@/domain/co2-wear';
import { getAsset } from './assets';
import type { PrismaClient } from './prisma-client';

/** Everything the estimator needs besides the asset and term. Plain data, safe to send to the browser. */
export type ImpactInputs = { factors: Co2FactorSet; wearPolicy: WearPolicy; method: ImpactMethod };

/** The current factor set, wear policy and method, or null when the data cannot be used. */
export async function loadImpactInputs(): Promise<ImpactInputs | null> {
  const [co2, residual] = await Promise.all([loadCo2Factors(), loadResidualCurves()]);
  const factors = buildHackathonFactorSet(co2);
  const wear = buildResidualProxyWearPolicy(residual);
  if (!factors.ok || !wear.ok) return null;
  return { factors: factors.factorSet, wearPolicy: wear.policy, method: DEFAULT_IMPACT_METHOD };
}

/** The asset fields the estimator reads, plus what we know about its history. */
export function impactSubject(asset: Asset) {
  return {
    asset: { category: asset.category, condition: asset.condition, usage: asset.usage },
    knownHistory: knownHistoryFromAsset(asset),
  };
}

export function estimateForAsset(
  asset: Asset,
  termMonths: number,
  inputs: ImpactInputs
): ImpactEstimateResult {
  return estimateRentalCo2Saving({ ...impactSubject(asset), termMonths, ...inputs });
}

export type AssetImpactResult =
  | { ok: true; result: ImpactEstimateResult }
  | { ok: false; reason: 'asset_not_found' | 'inputs_unavailable' };

/** Loads one asset and estimates renting it for `termMonths`. */
export async function estimateAssetImpact(
  db: PrismaClient,
  assetId: string,
  termMonths: number,
  inputs?: ImpactInputs | null
): Promise<AssetImpactResult> {
  const asset = await getAsset(db, assetId);
  if (!asset) return { ok: false, reason: 'asset_not_found' };
  const resolved = inputs === undefined ? await loadImpactInputs() : inputs;
  if (!resolved) return { ok: false, reason: 'inputs_unavailable' };
  return { ok: true, result: estimateForAsset(asset, termMonths, resolved) };
}
