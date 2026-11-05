import { beforeAll, describe, expect, it } from 'vitest';
import { loadRefurbishmentCosts } from '@/data/load';
import type { RefurbishmentCosts } from '@/data/schemas';
import {
  meetsCondition,
  parseRefurbishmentRule,
  parseUpgradeKey,
  requiredWork,
  upgradePath,
  type InspectedState,
} from './refurbishment-rules';

let rules: RefurbishmentCosts;
beforeAll(async () => {
  rules = await loadRefurbishmentCosts();
});

const ebike = (over: Partial<InspectedState> = {}): InspectedState => ({
  category: 'e_bike',
  condition: 'good',
  usageUnit: 'km',
  usageValue: 0,
  hoursSinceService: null,
  ...over,
});
const ids = (state: InspectedState) => requiredWork(state, rules).required.map((a) => a.id);

describe('parseRefurbishmentRule', () => {
  it('reads every rule form in the data pack', () => {
    expect(parseRefurbishmentRule('always')).toEqual({ kind: 'always' });
    expect(parseRefurbishmentRule('usage.value >= 15000 km')).toEqual({
      kind: 'usage_at_least',
      threshold: 15000,
      unit: 'km',
    });
    expect(parseRefurbishmentRule('per started 1000 engine_hours since last service')).toEqual({
      kind: 'per_started_since_service',
      step: 1000,
      unit: 'engine_hours',
    });
  });

  it('keeps unknown text unknown instead of guessing', () => {
    for (const text of ['sometimes', 'usage.value > 5 km', 'per started 0 km since last service'])
      expect(parseRefurbishmentRule(text)).toEqual({ kind: 'unknown' });
  });
});

describe('requiredWork: e-bike battery threshold', () => {
  it('requires the battery at 15000 km and above, not at 14999', () => {
    expect(ids(ebike({ usageValue: 14_999 }))).toEqual(['safety_inspection']);
    expect(ids(ebike({ usageValue: 15_000 }))).toEqual([
      'battery_replacement',
      'safety_inspection',
    ]);
    expect(ids(ebike({ usageValue: 15_001 }))).toContain('battery_replacement');
  });

  it('marks the battery as resetting usage', () => {
    const battery = requiredWork(ebike({ usageValue: 18_400 }), rules).required[0];
    expect(battery).toMatchObject({
      id: 'battery_replacement',
      resetsUsage: true,
      reason: 'usage_threshold',
    });
  });
});

describe('requiredWork: laptops', () => {
  const laptop = (usageValue: number): InspectedState => ({
    category: 'laptop',
    condition: 'good',
    usageUnit: 'battery_cycles',
    usageValue,
    hoursSinceService: null,
  });
  it('always requires the certified wipe and the battery from 500 cycles', () => {
    expect(ids(laptop(499))).toEqual(['certified_data_wipe']);
    expect(ids(laptop(500))).toEqual(['certified_data_wipe', 'battery_replacement']);
  });
});

describe('requiredWork: farm service hours', () => {
  const farm = (hoursSinceService: number | null): InspectedState => ({
    category: 'farm_machine',
    condition: 'good',
    usageUnit: 'engine_hours',
    usageValue: 4200,
    hoursSinceService,
  });

  it('asks for hours since service instead of assuming the lifetime counter', () => {
    const result = requiredWork(farm(null), rules);
    expect(result.missing).toEqual(['hours_since_service']);
    expect(result.required.map((a) => a.id)).toEqual(['safety_inspection']);
  });

  it('counts started intervals: 0 → none, 1 and 1000 → one, 1001 → two', () => {
    const service = (h: number) =>
      requiredWork(farm(h), rules).required.find((a) => a.id === 'major_service');
    expect(service(0)).toBeUndefined();
    expect(service(1)).toMatchObject({ quantity: 1 });
    expect(service(1000)).toMatchObject({ quantity: 1 });
    expect(service(1001)).toMatchObject({ quantity: 2 });
  });
});

describe('condition upgrades', () => {
  it('chains poor->fair->good and needs nothing from good upwards', () => {
    expect(ids(ebike({ condition: 'poor' }))).toEqual([
      'safety_inspection',
      'upgrade:poor->fair',
      'upgrade:fair->good',
    ]);
    expect(ids(ebike({ condition: 'fair' }))).toContain('upgrade:fair->good');
    expect(ids(ebike({ condition: 'like_new' }))).toEqual(['safety_inspection']);
  });

  it('uses a direct step when the data names one and reports a missing path', () => {
    expect(upgradePath('poor', ['poor->fair', 'fair->good', 'poor->good'])).toEqual([
      { from: 'poor', to: 'good' },
    ]);
    expect(upgradePath('poor', ['good->like_new'])).toBeNull();
    expect(upgradePath('good', [])).toEqual([]);
    const noPath = { ...rules, e_bike: { ...rules.e_bike, condition_upgrades: {} } };
    expect(requiredWork(ebike({ condition: 'fair' }), noPath).unsupported).toEqual([
      'no_upgrade_path',
    ]);
  });

  it('parses only improving steps between known conditions', () => {
    expect(parseUpgradeKey('fair->good')).toEqual({ from: 'fair', to: 'good' });
    expect(parseUpgradeKey('good->fair')).toBeNull();
    expect(parseUpgradeKey('shiny->good')).toBeNull();
    expect(parseUpgradeKey('a->b->c')).toBeNull();
    expect(meetsCondition('good', 'good')).toBe(true);
    expect(meetsCondition('fair', 'good')).toBe(false);
  });
});

it('reports a rule on another counter as unsupported', () => {
  const odd = {
    ...rules,
    laptop: {
      ...rules.laptop,
      fixed: [{ id: 'chain', cost_cents: 1, when: 'usage.value >= 1 km' }],
    },
  };
  const result = requiredWork(
    {
      category: 'laptop',
      condition: 'good',
      usageUnit: 'battery_cycles',
      usageValue: 9,
      hoursSinceService: null,
    },
    odd
  );
  expect(result.unsupported).toEqual(['chain']);
  expect(result.required).toEqual([]);
});
