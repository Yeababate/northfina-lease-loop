import { beforeAll, describe, expect, it } from 'vitest';
import { loadAssetAttributes, loadAssets } from '@/data/load';
import type { Asset, AssetAttributes } from '@/data/schemas';
import {
  attributeOptions,
  hasAttributeFilter,
  matchesAttributes,
  parseAttributeQuery,
  type AttributeQuery,
} from './catalogue-attributes';
import type { SearchParams } from './catalogue';

let assets: Asset[];
let attributes: AssetAttributes[];
let byId: Map<string, AssetAttributes>;
beforeAll(async () => {
  [assets, attributes] = await Promise.all([loadAssets(), loadAssetAttributes()]);
  byId = new Map(attributes.map((row) => [row.asset_id, row]));
});

/** The ids of the data pack's items that pass, with these categories ticked. */
function shown(params: SearchParams, categories: Asset['category'][]) {
  const query = parseAttributeQuery(params);
  return assets
    .filter((asset) => matchesAttributes(asset, byId.get(asset.id), query, categories))
    .map((asset) => asset.id);
}

const empty = parseAttributeQuery({});

describe('parseAttributeQuery', () => {
  it('has no filters for an empty URL', () => {
    expect(empty).toEqual({
      ebike: { motors: [], minWatts: null, minBatteryWh: null, minRangeKm: null, wheels: [] },
      laptop: { gpus: [], gpuModels: [] },
      farm: { types: [], minPowerKw: null, minWidthM: null, maxEngineHours: null },
    });
  });

  it('reads every parameter', () => {
    const query = parseAttributeQuery({
      ebike_motor: ['mid_drive', 'hub', 'mid_drive'],
      ebike_power_min: '350',
      ebike_battery_min: '500',
      ebike_range_min: '80',
      ebike_wheel: ['28', '29'],
      laptop_gpu: 'discrete',
      laptop_gpu_model: 'Aurora G8',
      farm_type: ['tractor'],
      farm_power_min: '100',
      farm_width_min: '2.5',
      farm_hours_max: '0',
    });
    expect(query).toEqual({
      ebike: {
        motors: ['mid_drive', 'hub'],
        minWatts: 350,
        minBatteryWh: 500,
        minRangeKm: 80,
        wheels: [28, 29],
      },
      laptop: { gpus: ['discrete'], gpuModels: ['Aurora G8'] },
      farm: { types: ['tractor'], minPowerKw: 100, minWidthM: 2.5, maxEngineHours: 0 },
    });
  });

  it('drops unknown choices and treats bad or zero minimums as no limit', () => {
    const query = parseAttributeQuery({
      ebike_motor: 'rocket',
      ebike_power_min: '-5',
      ebike_battery_min: '0',
      ebike_range_min: '1e3',
      ebike_wheel: ['abc', '0', ''],
      laptop_gpu: 'quantum',
      farm_type: 'spaceship',
      farm_width_min: '2.555',
      farm_hours_max: 'many',
    });
    expect(query).toEqual(empty);
  });

  it('does not accept decimals where whole numbers are expected', () => {
    expect(parseAttributeQuery({ ebike_power_min: '250.5' }).ebike.minWatts).toBeNull();
  });
});

describe('hasAttributeFilter', () => {
  it('is per category', () => {
    const query = parseAttributeQuery({ laptop_gpu: 'discrete' });
    expect(hasAttributeFilter(query, 'laptop')).toBe(true);
    expect(hasAttributeFilter(query, 'e_bike')).toBe(false);
    expect(hasAttributeFilter(query, 'farm_machine')).toBe(false);
    expect(hasAttributeFilter(parseAttributeQuery({ farm_hours_max: '0' }), 'farm_machine')).toBe(
      true
    );
  });
});

describe('matchesAttributes on the data pack', () => {
  it('keeps everything with no sub-filter', () => {
    expect(shown({}, ['e_bike', 'laptop', 'farm_machine'])).toHaveLength(30);
  });

  it('ignores a sub-filter while its category is not ticked', () => {
    expect(shown({ ebike_motor: 'mid_drive' }, [])).toHaveLength(30);
    expect(shown({ ebike_motor: 'mid_drive' }, ['laptop'])).toHaveLength(30);
  });

  it('filters e-bikes by motor and leaves other ticked categories alone', () => {
    const ids = shown({ ebike_motor: 'mid_drive' }, ['e_bike', 'laptop']);
    expect(ids.filter((id) => id.startsWith('ebike-'))).toEqual([
      'ebike-003',
      'ebike-004',
      'ebike-007',
      'ebike-009',
      'ebike-011',
      'ebike-012',
    ]);
    expect(ids.filter((id) => id.startsWith('laptop-'))).toHaveLength(10);
    expect(ids.filter((id) => id.startsWith('farm-'))).toHaveLength(8);
  });

  it('applies e-bike minimums inclusively', () => {
    expect(shown({ ebike_power_min: '500' }, ['e_bike']).filter(isEbike)).toEqual([
      'ebike-003',
      'ebike-012',
    ]);
    expect(shown({ ebike_battery_min: '900' }, ['e_bike']).filter(isEbike)).toEqual([
      'ebike-004',
      'ebike-007',
    ]);
    expect(shown({ ebike_range_min: '100' }, ['e_bike']).filter(isEbike)).toEqual([
      'ebike-004',
      'ebike-007',
      'ebike-011',
    ]);
  });

  it('filters e-bikes by any of the chosen wheel sizes', () => {
    expect(shown({ ebike_wheel: ['20', '24'] }, ['e_bike']).filter(isEbike)).toEqual([
      'ebike-004',
      'ebike-006',
      'ebike-007',
      'ebike-010',
    ]);
  });

  it('filters laptops by graphics', () => {
    const isLaptop = (id: string) => id.startsWith('laptop-');
    expect(shown({ laptop_gpu: 'integrated' }, ['laptop']).filter(isLaptop)).toEqual([
      'laptop-001',
      'laptop-005',
      'laptop-006',
      'laptop-009',
    ]);
    expect(shown({ laptop_gpu_model: 'Aurora G8' }, ['laptop']).filter(isLaptop)).toEqual([
      'laptop-008',
    ]);
    // Integrated and a discrete model together: nothing is both.
    expect(
      shown({ laptop_gpu: 'integrated', laptop_gpu_model: 'Aurora G8' }, ['laptop']).filter(
        isLaptop
      )
    ).toEqual([]);
  });

  it('filters farm machines by type, power and width; unknown values never pass a minimum', () => {
    const isFarm = (id: string) => id.startsWith('farm-');
    expect(shown({ farm_type: 'tractor' }, ['farm_machine']).filter(isFarm)).toEqual([
      'farm-001',
      'farm-002',
      'farm-005',
    ]);
    expect(shown({ farm_power_min: '100' }, ['farm_machine']).filter(isFarm)).toEqual([
      'farm-002',
      'farm-006',
    ]);
    expect(shown({ farm_width_min: '3' }, ['farm_machine']).filter(isFarm)).toEqual([
      'farm-004',
      'farm-006',
      'farm-008',
    ]);
  });

  it('filters farm machines by engine hours, inclusive', () => {
    const farm = assets.filter((asset) => asset.category === 'farm_machine');
    const used = farm.find((asset) => asset.usage.value > 0);
    if (!used) throw new Error('expected a used farm machine in the data pack');
    const atLimit = shown({ farm_hours_max: String(used.usage.value) }, ['farm_machine']);
    expect(atLimit).toContain(used.id);
    const below = shown({ farm_hours_max: String(used.usage.value - 1) }, ['farm_machine']);
    expect(below).not.toContain(used.id);
  });

  it('does not match when the filter is on but the item has no attributes', () => {
    const query: AttributeQuery = parseAttributeQuery({ laptop_gpu: 'discrete' });
    const laptop = { category: 'laptop', usage: { unit: 'battery_cycles', value: 0 } } as const;
    expect(matchesAttributes(laptop, undefined, query, ['laptop'])).toBe(false);
    expect(matchesAttributes(laptop, undefined, empty, ['laptop'])).toBe(true);
  });

  it('does not match engine hours for a machine counted in another unit', () => {
    const query = parseAttributeQuery({ farm_hours_max: '1000' });
    const machine = { category: 'farm_machine', usage: { unit: 'km', value: 10 } } as const;
    const row: AssetAttributes = {
      asset_id: 'x',
      category: 'farm_machine',
      machine_type: 'mower',
      power_kw: null,
      working_width_m: 3,
    };
    expect(matchesAttributes(machine, row, query, ['farm_machine'])).toBe(false);
  });
});

describe('attributeOptions', () => {
  it('lists wheel sizes and graphics models, sorted and without repeats', () => {
    expect(attributeOptions(attributes)).toEqual({
      wheels: [20, 24, 26, 28, 29],
      gpuModels: ['Aurora G4', 'Aurora G6', 'Aurora G8', 'Aurora iG2'],
    });
  });

  it('is empty with no rows', () => {
    expect(attributeOptions([])).toEqual({ wheels: [], gpuModels: [] });
  });
});

function isEbike(id: string) {
  return id.startsWith('ebike-');
}
