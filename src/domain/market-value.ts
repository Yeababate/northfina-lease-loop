// Market value of a used item (#39), as data/residual-curves.json describes it:
//
//   value = net list price × curve(age in months) × condition multiplier × usage adjustment
//
// - The curve is interpolated linearly between its points and held at the last point after.
// - Age: the data pack has no first-lease date, so an item's age is counted from 1 January of
//   its model year. A documented, deliberately simple choice.
// - Usage adjustment: every completed step of `step` units lowers the value by
//   `percent_per_step`, never by more than `max_total_percent`.
//
// Rounding: every factor is held as whole parts per million and the product is formed in
// BigInt, then rounded ONCE to whole cents, half up. No floating-point money.
import type { AssetCategory, AssetCondition, ResidualCurves } from '@/data/schemas';
import { toScaledInteger } from './rounding';

const PPM = 1_000_000;

export type ValuedItem = {
  category: AssetCategory;
  condition: AssetCondition;
  usageValue: number;
  /** The net list price the curve starts from. */
  listPriceCents: number;
  ageMonths: number;
};

export type MarketValue = {
  valueCents: number;
  curvePpm: number;
  conditionPpm: number;
  usagePpm: number;
};

export function marketValue(item: ValuedItem, curves: ResidualCurves): MarketValue {
  if (!Number.isSafeInteger(item.listPriceCents) || item.listPriceCents < 0)
    throw new RangeError('List price must be non-negative whole cents');
  if (!Number.isSafeInteger(item.ageMonths) || item.ageMonths < 0)
    throw new RangeError('Age must be whole months');
  if (!Number.isSafeInteger(item.usageValue) || item.usageValue < 0)
    throw new RangeError('Usage must be a non-negative whole number');

  const curvePpm = curveAt(curves.curves[item.category] ?? [], item.ageMonths);
  const conditionPpm = toScaledInteger(curves.condition_multiplier[item.condition] ?? 0, PPM);
  const rule = curves.usage_adjustment[item.category];
  let usagePpm = PPM;
  if (rule) {
    const steps = Math.floor(item.usageValue / rule.step);
    const percent = Math.max(rule.max_total_percent, steps * rule.percent_per_step);
    usagePpm = Math.max(0, PPM + toScaledInteger(percent, 10_000));
  }

  const numerator =
    BigInt(item.listPriceCents) * BigInt(curvePpm) * BigInt(conditionPpm) * BigInt(usagePpm);
  const denominator = BigInt(PPM) ** 3n;
  const valueCents = Number((numerator * 2n + denominator) / (denominator * 2n));
  return { valueCents, curvePpm, conditionPpm, usagePpm };
}

/** The curve's percentage at `ageMonths`, as ppm of the list price. */
export function curveAt(points: readonly (readonly [number, number])[], ageMonths: number): number {
  const ppm = (percent: number) => toScaledInteger(percent, 10_000);
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return 0;
  if (ageMonths <= first[0]) return ppm(first[1]);
  if (ageMonths >= last[0]) return ppm(last[1]);
  for (let i = 1; i < sorted.length; i += 1) {
    const [a0, p0] = sorted[i - 1]!;
    const [a1, p1] = sorted[i]!;
    if (ageMonths <= a1) {
      // Weighted average of the two neighbours, rounded once, half up.
      const total = ppm(p0) * (a1 - ageMonths) + ppm(p1) * (ageMonths - a0);
      const span = a1 - a0;
      return Math.floor((total * 2 + span) / (span * 2));
    }
  }
  return ppm(last[1]);
}

/** Whole months from 1 January of the model year to `today` (ISO date). */
export function ageInMonths(modelYear: number, today: string): number {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return Math.max(0, (year - modelYear) * 12 + (month - 1));
}
