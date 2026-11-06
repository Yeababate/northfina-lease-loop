import { beforeAll, describe, expect, it } from 'vitest';
import { loadAssets, loadCo2Factors, loadResidualCurves } from '@/data/load';
import type { Asset, Co2Factors } from '@/data/schemas';
import { buildFactorSet, buildHackathonFactorSet, type Co2FactorSet } from './co2-factors';
import {
  combineEstimates,
  DEFAULT_IMPACT_METHOD,
  estimateRentalCo2Saving,
  knownHistoryFromAsset,
  type ImpactAsset,
  type ImpactEstimateInput,
  type ImpactMethod,
  type KnownHistory,
} from './co2-impact';
import { buildResidualProxyWearPolicy, type WearPolicy } from './co2-wear';

let rawFactors: Co2Factors;
let factors: Co2FactorSet;
let wearPolicy: WearPolicy;
let assets: Asset[];
beforeAll(async () => {
  rawFactors = await loadCo2Factors();
  const f = buildHackathonFactorSet(rawFactors);
  const w = buildResidualProxyWearPolicy(await loadResidualCurves());
  if (!f.ok || !w.ok) throw new Error('default inputs must build');
  factors = f.factorSet;
  wearPolicy = w.policy;
  assets = await loadAssets();
});

const newEbike: ImpactAsset = {
  category: 'e_bike',
  condition: 'new',
  usage: { unit: 'km', value: 0 },
};
const firstUse: KnownHistory = { previousLives: 0, usage: { kind: 'no_reset_recorded' } };
const secondLife: KnownHistory = { previousLives: 1, usage: { kind: 'no_reset_recorded' } };

const input = (overrides: Partial<ImpactEstimateInput> = {}): ImpactEstimateInput => ({
  asset: newEbike,
  termMonths: 36,
  knownHistory: firstUse,
  factors,
  wearPolicy,
  method: DEFAULT_IMPACT_METHOD,
  ...overrides,
});
const estimate = (overrides: Partial<ImpactEstimateInput> = {}) => {
  const result = estimateRentalCo2Saving(input(overrides));
  if (!result.ok) throw new Error(result.reason);
  return result.estimate;
};

describe('estimateRentalCo2Saving: worked examples from the plan', () => {
  it('new e-bike, credit 1: 165 kg − 19.8 kg = 145.2 kg', () => {
    expect(estimate()).toMatchObject({
      manufacturingBaselineGrams: 165_000,
      creditedManufacturingGrams: 165_000,
      refurbishmentAllowanceGrams: 19_800,
      estimatedSavingGrams: 145_200,
      appliedCreditPpm: 1_000_000,
      outcome: 'saving',
      context: 'first_use',
    });
  });

  it('worn e-bike, credit 0.68 (good, capped km): 112.2 kg − 19.8 kg = 92.4 kg', () => {
    const worn = estimate({
      asset: { category: 'e_bike', condition: 'good', usage: { unit: 'km', value: 18_400 } },
      knownHistory: secondLife,
    });
    expect(worn).toMatchObject({
      appliedCreditPpm: 680_000,
      creditedManufacturingGrams: 112_200,
      refurbishmentAllowanceGrams: 19_800,
      estimatedSavingGrams: 92_400,
      context: 'reuse',
      previousLives: 1,
    });
  });

  it('the breakdown always adds up exactly', () => {
    for (const asset of assets) {
      const result = estimateRentalCo2Saving(
        input({ asset, knownHistory: knownHistoryFromAsset(asset) })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const e = result.estimate;
      expect(e.estimatedSavingGrams).toBe(
        e.creditedManufacturingGrams - e.refurbishmentAllowanceGrams
      );
      expect(Number.isSafeInteger(e.estimatedSavingGrams)).toBe(true);
    }
  });
});

describe('first use and reuse', () => {
  it('estimates a first-use item with the same method instead of zero', () => {
    const first = estimate({ knownHistory: firstUse });
    const reused = estimate({ knownHistory: { ...secondLife, previousLives: 3 } });
    expect(first.estimatedSavingGrams).toBe(reused.estimatedSavingGrams);
    expect(first.assumptions).toContain('first_use_future_circulation');
    expect(reused.assumptions).toContain('reuse_previous_lives');
    expect(reused.assumptions).not.toContain('first_use_future_circulation');
  });

  it('a replaced first-use method changes only first-use items', () => {
    const halved: ImpactMethod = {
      id: 'test-halved-first-use',
      version: 2,
      firstUse: { treatment: 'scaled_credit', creditScalePpm: 500_000 },
    };
    const first = estimate({ method: halved });
    expect(first).toMatchObject({
      appliedCreditPpm: 500_000,
      estimatedSavingGrams: 82_500 - 19_800,
    });
    expect(first.assumptions).toContain('first_use_scaled');
    expect(first.versions).toMatchObject({ methodId: 'test-halved-first-use', methodVersion: 2 });
    expect(estimate({ method: halved, knownHistory: secondLife }).estimatedSavingGrams).toBe(
      145_200
    );
  });

  it('refuses an invalid first-use scale', () => {
    const bad: ImpactMethod = {
      ...DEFAULT_IMPACT_METHOD,
      firstUse: { treatment: 'scaled_credit', creditScalePpm: 2_000_000 },
    };
    expect(estimateRentalCo2Saving(input({ method: bad }))).toMatchObject({
      ok: false,
      reason: 'invalid_method',
    });
  });
});

describe('wear', () => {
  it('more usage gives a smaller or equal saving', () => {
    const at = (km: number) =>
      estimate({
        asset: { ...newEbike, condition: 'fair', usage: { unit: 'km', value: km } },
        knownHistory: secondLife,
      }).estimatedSavingGrams;
    expect(at(0)).toBeGreaterThan(at(5000));
    expect(at(10_000)).toBe(at(50_000));
  });

  it('a counter reset with unknown prior usage gets the maximum penalty', () => {
    const reset = estimate({
      knownHistory: { previousLives: 2, usage: { kind: 'reset_unknown_prior' } },
    });
    expect(reset.appliedCreditPpm).toBe(800_000);
    expect(reset.assumptions).toContain('counter_reset_prior_unknown');
  });

  it('a counter reset with known prior usage adds it back', () => {
    const reset = estimate({
      knownHistory: {
        previousLives: 1,
        usage: { kind: 'reset_with_known_prior', priorUsage: 2000 },
      },
    });
    expect(reset.appliedCreditPpm).toBe(960_000);
    expect(reset.assumptions).toContain('counter_reset_prior_added');
  });
});

describe('zero and negative results are kept', () => {
  it('reports no saving when credit equals the refurbishment allowance', () => {
    const policy: WearPolicy = {
      ...wearPolicy,
      conditionCreditPpm: { ...wearPolicy.conditionCreditPpm, poor: 120_000 },
    };
    const e = estimate({ wearPolicy: policy, asset: { ...newEbike, condition: 'poor' } });
    expect(e).toMatchObject({ estimatedSavingGrams: 0, outcome: 'no_saving' });
  });

  it('reports additional impact, with its negative sign, when credit is below the allowance', () => {
    const policy: WearPolicy = {
      ...wearPolicy,
      conditionCreditPpm: { ...wearPolicy.conditionCreditPpm, poor: 50_000 },
    };
    const e = estimate({ wearPolicy: policy, asset: { ...newEbike, condition: 'poor' } });
    expect(e).toMatchObject({ estimatedSavingGrams: 8_250 - 19_800, outcome: 'additional_impact' });
  });
});

describe('rounding', () => {
  it('rounds each component once, half up, to whole grams', () => {
    const custom = buildFactorSet(
      {
        ...rawFactors,
        manufacturing_new_kg: { e_bike: 0.005 },
        refurbishment_share_of_new: 0.1,
      } as Co2Factors,
      { id: 'tiny', version: 1, status: 'fictional_illustrative', sourceReference: 'test' }
    );
    if (!custom.ok) throw new Error('must build');
    // 5 g × 0.1 = 0.5 g → 1 g (half up); 5 g × 1 = 5 g; saving 4 g.
    expect(estimate({ factors: custom.factorSet })).toMatchObject({
      creditedManufacturingGrams: 5,
      refurbishmentAllowanceGrams: 1,
      estimatedSavingGrams: 4,
    });
  });
});

describe('unavailable estimates are values, not made-up amounts', () => {
  it('has no estimate for a category without a factor', () => {
    const noLaptop: Co2FactorSet = { ...factors, manufacturingNewGrams: { e_bike: 165_000 } };
    const result = estimateRentalCo2Saving(
      input({
        factors: noLaptop,
        asset: {
          category: 'laptop',
          condition: 'new',
          usage: { unit: 'battery_cycles', value: 0 },
        },
      })
    );
    expect(result).toMatchObject({
      ok: false,
      reason: 'no_factor',
      versions: { factorSetId: 'hackathon-fictional' },
    });
  });

  it('refuses a refurbishment share outside 0..1', () => {
    expect(
      estimateRentalCo2Saving(
        input({ factors: { ...factors, refurbishmentShareOfNewPpm: 1_000_001 } })
      )
    ).toMatchObject({ ok: false, reason: 'no_factor' });
  });

  it('refuses a footprint too large to compute exactly', () => {
    const huge: Co2FactorSet = {
      ...factors,
      manufacturingNewGrams: { e_bike: Number.MAX_SAFE_INTEGER },
    };
    expect(estimateRentalCo2Saving(input({ factors: huge }))).toMatchObject({
      ok: false,
      reason: 'no_factor',
    });
  });

  it.each([0, -12, 1.5, Number.NaN])('refuses term %s', (termMonths) => {
    expect(estimateRentalCo2Saving(input({ termMonths }))).toMatchObject({
      ok: false,
      reason: 'invalid_term',
    });
  });

  it('refuses invalid previous lives', () => {
    expect(
      estimateRentalCo2Saving(input({ knownHistory: { ...firstUse, previousLives: -1 } }))
    ).toMatchObject({ ok: false, reason: 'invalid_history' });
  });

  it('passes a wear-policy problem through', () => {
    const result = estimateRentalCo2Saving(
      input({ asset: { ...newEbike, usage: { unit: 'engine_hours', value: 0 } } })
    );
    expect(result).toMatchObject({ ok: false, reason: 'usage_unit_mismatch' });
  });
});

describe('term, versions and assumptions', () => {
  it('the term is carried but does not change this simple estimate', () => {
    const short = estimate({ termMonths: 12 });
    const long = estimate({ termMonths: 48 });
    expect(short.estimatedSavingGrams).toBe(long.estimatedSavingGrams);
    expect([short.termMonths, long.termMonths]).toEqual([12, 48]);
    expect(short.assumptions).toContain('term_not_allocated');
  });

  it('records the factor, wear and method versions it used', () => {
    expect(estimate().versions).toEqual({
      factorSetId: 'hackathon-fictional',
      factorSetVersion: 1,
      factorSetStatus: 'fictional_illustrative',
      wearPolicyId: 'residual-proxy',
      wearPolicyVersion: 1,
      methodId: 'prospective-circular-use',
      methodVersion: 1,
    });
  });

  it('an estimate keeps its original factor version when a new factor set appears', () => {
    const before = estimate();
    const sourced = buildFactorSet(
      { ...rawFactors, manufacturing_new_kg: { ...rawFactors.manufacturing_new_kg, e_bike: 200 } },
      { id: 'hackathon-fictional', version: 2, status: 'sourced', sourceReference: 'test' }
    );
    if (!sourced.ok) throw new Error('must build');
    const after = estimate({ factors: sourced.factorSet });
    expect(before.versions.factorSetVersion).toBe(1);
    expect(before.estimatedSavingGrams).toBe(145_200);
    expect(after.versions.factorSetVersion).toBe(2);
    expect(after.assumptions).toContain('sourced_factors');
    expect(after.assumptions).not.toContain('fictional_factors');
  });

  it('always lists the illustrative assumptions and never a travel credit', () => {
    expect(estimate().assumptions).toEqual(
      expect.arrayContaining([
        'fictional_factors',
        'not_measured',
        'compared_with_new',
        'wear_price_proxy',
        'refurbishment_hypothetical',
        'no_travel_credit',
        'counter_assumed_lifetime',
      ])
    );
  });
});

describe('knownHistoryFromAsset', () => {
  it('uses previous lives and records that no counter reset is known', () => {
    expect(knownHistoryFromAsset({ previous_lives: 2 })).toEqual({
      previousLives: 2,
      usage: { kind: 'no_reset_recorded' },
    });
  });
});

describe('combineEstimates', () => {
  it('sums gram outputs and marks a package with a missing line as partial', () => {
    const a = estimateRentalCo2Saving(input());
    const missing = estimateRentalCo2Saving(input({ termMonths: 0 }));
    expect(combineEstimates([a, a])).toEqual({
      totalSavingGrams: 290_400,
      estimatedCount: 2,
      unavailableCount: 0,
      partial: false,
    });
    expect(combineEstimates([a, missing])).toEqual({
      totalSavingGrams: 145_200,
      estimatedCount: 1,
      unavailableCount: 1,
      partial: true,
    });
    expect(combineEstimates([])).toEqual({
      totalSavingGrams: 0,
      estimatedCount: 0,
      unavailableCount: 0,
      partial: false,
    });
  });
});
