// Catalogue sub-filters per category (#72): e-bike motor, power, battery, range and wheel size;
// laptop graphics; farm machine type, power, working width and engine hours. Each group only
// applies while its category is ticked, and only to items of that category, so ticking e-bikes
// and laptops with "mid-drive" set still shows every laptop.
import {
  ebikeMotorSchema,
  farmMachineTypeSchema,
  laptopGpuSchema,
  type Asset,
  type AssetAttributes,
  type AssetCategory,
  type EbikeMotor,
  type FarmMachineType,
  type LaptopGpu,
} from '@/data/schemas';
import type { SearchParams } from './catalogue';

export type AttributeQuery = {
  ebike: {
    motors: EbikeMotor[];
    minWatts: number | null;
    minBatteryWh: number | null;
    minRangeKm: number | null;
    wheels: number[];
  };
  laptop: { gpus: LaptopGpu[]; gpuModels: string[] };
  farm: {
    types: FarmMachineType[];
    minPowerKw: number | null;
    /** Metres; may have up to two decimals. */
    minWidthM: number | null;
    maxEngineHours: number | null;
  };
};

/** The URL parameter names, so the form and the parser cannot drift apart. */
export const attributeParams = {
  ebikeMotor: 'ebike_motor',
  ebikePowerMin: 'ebike_power_min',
  ebikeBatteryMin: 'ebike_battery_min',
  ebikeRangeMin: 'ebike_range_min',
  ebikeWheel: 'ebike_wheel',
  laptopGpu: 'laptop_gpu',
  laptopGpuModel: 'laptop_gpu_model',
  farmType: 'farm_type',
  farmPowerMin: 'farm_power_min',
  farmWidthMin: 'farm_width_min',
  farmHoursMax: 'farm_hours_max',
} as const;

/**
 * Reads the sub-filters from the URL. Unknown choices are dropped and a number that is not a
 * plain non-negative number means "no limit"; a minimum of 0 is no limit too. A maximum of 0
 * engine hours is kept: it means "unused machines only".
 */
export function parseAttributeQuery(params: SearchParams): AttributeQuery {
  const p = attributeParams;
  const all = (key: string) => {
    const value = params[key];
    const list = value === undefined ? [] : Array.isArray(value) ? value : [value];
    return [...new Set(list.map((item) => item.trim()).filter((item) => item !== ''))];
  };
  const first = (key: string) => all(key)[0] ?? '';
  const minimum = (key: string, decimals = false) => {
    const value = number(first(key), decimals);
    return value === 0 ? null : value;
  };

  return {
    ebike: {
      motors: all(p.ebikeMotor).filter(isIn(ebikeMotorSchema.options)),
      minWatts: minimum(p.ebikePowerMin),
      minBatteryWh: minimum(p.ebikeBatteryMin),
      minRangeKm: minimum(p.ebikeRangeMin),
      wheels: all(p.ebikeWheel)
        .map((wheel) => number(wheel, false))
        .filter((wheel): wheel is number => wheel !== null && wheel > 0),
    },
    laptop: {
      gpus: all(p.laptopGpu).filter(isIn(laptopGpuSchema.options)),
      gpuModels: all(p.laptopGpuModel).map((model) => model.slice(0, 50)),
    },
    farm: {
      types: all(p.farmType).filter(isIn(farmMachineTypeSchema.options)),
      minPowerKw: minimum(p.farmPowerMin),
      minWidthM: minimum(p.farmWidthMin, true),
      maxEngineHours: number(first(p.farmHoursMax), false),
    },
  };
}

/** Does the item pass the sub-filters of the ticked categories? */
export function matchesAttributes(
  asset: Pick<Asset, 'category' | 'usage'>,
  attributes: AssetAttributes | undefined,
  query: AttributeQuery,
  categories: readonly AssetCategory[]
): boolean {
  if (!categories.includes(asset.category) || !hasAttributeFilter(query, asset.category))
    return true;
  // A filter is on for this category, but nothing is known about the item: it cannot match.
  if (attributes === undefined || attributes.category !== asset.category) return false;

  switch (attributes.category) {
    case 'e_bike': {
      const q = query.ebike;
      return (
        anyOf(q.motors, attributes.motor) &&
        atLeast(attributes.motor_watts, q.minWatts) &&
        atLeast(attributes.battery_wh, q.minBatteryWh) &&
        atLeast(attributes.range_km, q.minRangeKm) &&
        anyOf(q.wheels, attributes.wheel_inches)
      );
    }
    case 'laptop': {
      const q = query.laptop;
      return anyOf(q.gpus, attributes.gpu) && anyOf(q.gpuModels, attributes.gpu_model);
    }
    case 'farm_machine': {
      const q = query.farm;
      const hours = asset.usage.unit === 'engine_hours' ? asset.usage.value : null;
      return (
        anyOf(q.types, attributes.machine_type) &&
        atLeast(attributes.power_kw, q.minPowerKw) &&
        atLeast(attributes.working_width_m, q.minWidthM) &&
        (q.maxEngineHours === null || (hours !== null && hours <= q.maxEngineHours))
      );
    }
  }
}

/** Is any sub-filter of this category set? */
export function hasAttributeFilter(query: AttributeQuery, category: AssetCategory): boolean {
  const group =
    category === 'e_bike' ? query.ebike : category === 'laptop' ? query.laptop : query.farm;
  return Object.values(group).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== null
  );
}

export type AttributeOptions = { wheels: number[]; gpuModels: string[] };

/** The wheel sizes and graphics models on offer, sorted, for the filter's choices. */
export function attributeOptions(rows: readonly AssetAttributes[]): AttributeOptions {
  const wheels = new Set<number>();
  const gpuModels = new Set<string>();
  for (const row of rows) {
    if (row.category === 'e_bike') wheels.add(row.wheel_inches);
    if (row.category === 'laptop') gpuModels.add(row.gpu_model);
  }
  return {
    wheels: [...wheels].sort((a, b) => a - b),
    gpuModels: [...gpuModels].sort((a, b) => a.localeCompare(b)),
  };
}

function anyOf<T>(chosen: readonly T[], value: T): boolean {
  return chosen.length === 0 || chosen.includes(value);
}

function atLeast(value: number | null, minimum: number | null): boolean {
  return minimum === null || (value !== null && value >= minimum);
}

function number(text: string, decimals: boolean): number | null {
  const pattern = decimals ? /^\d{1,6}(\.\d{1,2})?$/ : /^\d{1,7}$/;
  return pattern.test(text) ? Number(text) : null;
}

function isIn<T extends string>(options: readonly T[]) {
  return (value: string): value is T => (options as readonly string[]).includes(value);
}
