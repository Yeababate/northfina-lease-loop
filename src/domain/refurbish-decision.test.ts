import { beforeAll, describe, expect, it } from 'vitest';
import { loadAssets, loadRefurbishmentCosts } from '@/data/load';
import type { Asset, RefurbishmentCosts } from '@/data/schemas';
import { decideRefurbishment } from './refurbish-decision';
import type { InspectedState } from './refurbishment-rules';

let assets: Asset[];
let rules: RefurbishmentCosts;
beforeAll(async () => {
  [assets, rules] = await Promise.all([loadAssets(), loadRefurbishmentCosts()]);
});

function inspected(id: string): InspectedState {
  const asset = assets.find((entry) => entry.id === id)!;
  return {
    category: asset.category,
    condition: asset.condition,
    usageUnit: asset.usage.unit,
    usageValue: asset.usage.value,
    hoursSinceService: null,
  };
}

describe('decideRefurbishment', () => {
  const ebikeValue = ({
    condition,
    usageValue,
  }: Pick<InspectedState, 'condition' | 'usageValue'>) =>
    155_000 + (condition === 'fair' ? 0 : condition === 'good' ? 20_000 : 25_000) - usageValue * 2;

  it('prices the e-bike battery, inspection and upgrade using the reset counter', () => {
    const decision = decideRefurbishment(inspected('ebike-007'), rules, ebikeValue);
    expect(decision.marketValueBeforeCents).toBe(118_200);
    expect(decision.options[0]).toMatchObject({
      id: 'to_good',
      after: { condition: 'good', usageValue: 0 },
      costCents: 51_500,
      marketValueCents: 175_000,
      netValueAddedCents: 5_300,
      leasable: true,
      work: [
        { action: { id: 'battery_replacement' }, costCents: 35_000 },
        { action: { id: 'safety_inspection' }, costCents: 4_500 },
        { action: { id: 'upgrade:fair->good' }, costCents: 12_000 },
      ],
    });
    expect(decision.recommendation).toEqual({ optionId: 'to_good', reason: 'best_net_value' });
  });

  it('can keep a fair bike for an accepting renter with all fixed work included', () => {
    const { options } = decideRefurbishment(inspected('ebike-007'), rules, ebikeValue, 'fair');
    expect(options[0]).toMatchObject({
      id: 'as_is',
      after: { condition: 'fair', usageValue: 0 },
      costCents: 39_500,
      leasable: true,
    });
  });

  it('includes the laptop data wipe even when there are no condition upgrades', () => {
    const { options, recommendation } = decideRefurbishment(
      inspected('laptop-006'),
      rules,
      () => 90_000
    );
    expect(options[0]).toMatchObject({
      id: 'as_is',
      work: [{ action: { id: 'certified_data_wipe' }, costCents: 2_500 }],
      costCents: 2_500,
      netValueAddedCents: -2_500,
      leasable: true,
    });
    expect(recommendation).toEqual({ optionId: 'as_is', reason: 'mandatory_step_only' });
  });

  it('requires service hours and charges for each started farm service interval', () => {
    const state = inspected('farm-001');
    const incomplete = decideRefurbishment(state, rules, () => 2_000_000);
    expect(incomplete.options[0]).toMatchObject({
      missing: ['hours_since_service'],
      leasable: false,
      marketValueCents: null,
    });
    expect(incomplete.recommendation.reason).toBe('incomplete_requirements');

    const priced = decideRefurbishment(
      { ...state, hoursSinceService: 1_001 },
      rules,
      () => 2_000_000
    );
    expect(priced.options[0]?.work).toContainEqual({
      action: expect.objectContaining({ id: 'major_service', quantity: 2 }),
      costCents: 300_000,
    });
  });
});
