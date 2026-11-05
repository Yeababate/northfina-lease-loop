import { beforeAll, describe, expect, it } from 'vitest';
import { loadResidualCurves } from '@/data/load';
import type { AssetCondition, ResidualCurves } from '@/data/schemas';
import {
  buildResidualProxyWearPolicy,
  calculateWearCredit,
  type UsageHistory,
  type WearInput,
  type WearPolicy,
} from './co2-wear';

let residual: ResidualCurves;
let policy: WearPolicy;
beforeAll(async () => {
  residual = await loadResidualCurves();
  const built = buildResidualProxyWearPolicy(residual);
  if (!built.ok) throw new Error('default wear policy must build');
  policy = built.policy;
});

const noReset: UsageHistory = { kind: 'no_reset_recorded' };
const ebike = (
  condition: AssetCondition,
  km: number,
  history: UsageHistory = noReset
): WearInput => ({
  category: 'e_bike',
  condition,
  usage: { unit: 'km', value: km },
  history,
});
const credit = (input: WearInput) => {
  const result = calculateWearCredit(input, policy);
  if (!result.ok) throw new Error(result.reason);
  return result.wear;
};

describe('buildResidualProxyWearPolicy', () => {
  it('copies condition multipliers and usage penalties as ppm, marked as a price proxy', () => {
    expect(policy.basis).toBe('price_derived_proxy');
    expect(policy.conditionCreditPpm).toEqual({
      new: 1_000_000,
      like_new: 950_000,
      good: 850_000,
      fair: 650_000,
      poor: 400_000,
    });
    expect(policy.usagePenalty.e_bike).toEqual({
      unit: 'km',
      step: 1000,
      penaltyPerStepPpm: 20_000,
      maxPenaltyPpm: 200_000,
    });
    expect(policy.usagePenalty.farm_machine?.maxPenaltyPpm).toBe(300_000);
    expect(policy.unknownPriorUsage).toBe('max_penalty');
  });

  it('is a copy: changing the residual data afterwards does not change the policy', () => {
    const copy = structuredClone(residual);
    const built = buildResidualProxyWearPolicy(copy);
    copy.condition_multiplier.good = 0.1;
    expect(built.ok && built.policy.conditionCreditPpm.good).toBe(850_000);
  });

  it('refuses a usage rule that would increase credit with use', () => {
    const bad = structuredClone(residual);
    bad.usage_adjustment.laptop.percent_per_step = 1.5;
    expect(buildResidualProxyWearPolicy(bad)).toEqual({
      ok: false,
      reason: 'invalid_wear_data',
      field: 'usage.laptop',
    });
  });

  it('refuses a positive cap and a cap above 100 %', () => {
    for (const max of [5, -150]) {
      const bad = structuredClone(residual);
      bad.usage_adjustment.e_bike.max_total_percent = max;
      expect(buildResidualProxyWearPolicy(bad).ok).toBe(false);
    }
  });

  it('refuses a condition multiplier above 1', () => {
    const bad = structuredClone(residual);
    bad.condition_multiplier.new = 1.2;
    expect(buildResidualProxyWearPolicy(bad)).toEqual({
      ok: false,
      reason: 'invalid_wear_data',
      field: 'condition.new',
    });
  });
});

describe('calculateWearCredit', () => {
  it('gives full credit to a new, unused item', () => {
    expect(credit(ebike('new', 0))).toMatchObject({
      creditPpm: 1_000_000,
      usagePenaltyPpm: 0,
      effectiveUsage: 0,
      penaltyCapped: false,
    });
  });

  it('multiplies condition credit by the usage reduction: good, 3 000 km → 0.85 × 0.94', () => {
    expect(credit(ebike('good', 3000)).creditPpm).toBe(799_000);
  });

  it('counts completed steps only: 999 km is no penalty, 1000 km is one step', () => {
    expect(credit(ebike('new', 999)).usagePenaltyPpm).toBe(0);
    expect(credit(ebike('new', 1000)).usagePenaltyPpm).toBe(20_000);
  });

  it('caps the usage penalty exactly at the limit', () => {
    expect(credit(ebike('new', 9999))).toMatchObject({
      usagePenaltyPpm: 180_000,
      penaltyCapped: false,
    });
    expect(credit(ebike('new', 10_000))).toMatchObject({
      usagePenaltyPpm: 200_000,
      penaltyCapped: true,
    });
    expect(credit(ebike('good', 1_000_000))).toMatchObject({
      creditPpm: 680_000,
      penaltyCapped: true,
    });
  });

  it('never increases credit for worse condition or more usage', () => {
    const order: AssetCondition[] = ['new', 'like_new', 'good', 'fair', 'poor'];
    for (const km of [0, 2500, 12_000]) {
      const credits = order.map((condition) => credit(ebike(condition, km)).creditPpm);
      expect([...credits].sort((a, b) => b - a)).toEqual(credits);
    }
    let previous = Number.POSITIVE_INFINITY;
    for (let km = 0; km <= 15_000; km += 500) {
      const current = credit(ebike('fair', km)).creditPpm;
      expect(current).toBeLessThanOrEqual(previous);
      previous = current;
    }
  });

  it('uses the category unit: laptops by battery cycles, farm machines by engine hours', () => {
    const laptop = calculateWearCredit(
      {
        category: 'laptop',
        condition: 'like_new',
        usage: { unit: 'battery_cycles', value: 250 },
        history: noReset,
      },
      policy
    );
    expect(laptop.ok && laptop.wear.creditPpm).toBe(921_500); // 0.95 × (1 − 0.03)
    const farm = calculateWearCredit(
      {
        category: 'farm_machine',
        condition: 'poor',
        usage: { unit: 'engine_hours', value: 6000 },
        history: noReset,
      },
      policy
    );
    expect(farm.ok && farm.wear.creditPpm).toBe(280_000); // 0.4 × (1 − 0.30 cap)
  });

  it('rejects a usage unit that does not belong to the category', () => {
    expect(
      calculateWearCredit(
        {
          category: 'e_bike',
          condition: 'new',
          usage: { unit: 'engine_hours', value: 1 },
          history: noReset,
        },
        policy
      )
    ).toEqual({ ok: false, reason: 'usage_unit_mismatch' });
  });

  it('rejects negative or fractional usage', () => {
    expect(calculateWearCredit(ebike('new', -1), policy)).toEqual({
      ok: false,
      reason: 'invalid_usage',
    });
    expect(calculateWearCredit(ebike('new', 1.5), policy)).toEqual({
      ok: false,
      reason: 'invalid_usage',
    });
    expect(
      calculateWearCredit(
        ebike('new', 0, { kind: 'reset_with_known_prior', priorUsage: -5 }),
        policy
      )
    ).toEqual({ ok: false, reason: 'invalid_usage' });
  });

  it('has no rule for a category the policy does not cover', () => {
    const partial: WearPolicy = { ...policy, usagePenalty: {} };
    expect(calculateWearCredit(ebike('new', 0), partial)).toEqual({
      ok: false,
      reason: 'no_wear_rule',
    });
  });

  describe('counter resets', () => {
    it('adds known usage before a reset, so a reset does not make an item look unused', () => {
      const wear = credit(ebike('good', 200, { kind: 'reset_with_known_prior', priorUsage: 4800 }));
      expect(wear).toMatchObject({
        effectiveUsage: 5000,
        usagePenaltyPpm: 100_000,
        history: 'reset_with_known_prior',
      });
      expect(wear.creditPpm).toBeLessThan(credit(ebike('good', 200)).creditPpm);
    });

    it('treats unknown usage before a reset as the maximum penalty, not zero', () => {
      const wear = credit(ebike('like_new', 0, { kind: 'reset_unknown_prior' }));
      expect(wear).toMatchObject({
        effectiveUsage: null,
        usagePenaltyPpm: 200_000,
        penaltyCapped: false,
        creditPpm: 760_000,
        history: 'reset_unknown_prior',
      });
    });
  });

  it('keeps the credit within 0..1 even with a full-penalty policy', () => {
    const harsh: WearPolicy = {
      ...policy,
      usagePenalty: {
        e_bike: { unit: 'km', step: 1, penaltyPerStepPpm: 1_000_000, maxPenaltyPpm: 1_000_000 },
      },
    };
    expect(calculateWearCredit(ebike('new', 5), harsh)).toMatchObject({
      ok: true,
      wear: { creditPpm: 0 },
    });
  });
});
