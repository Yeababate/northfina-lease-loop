import type { Asset, CoefficientTable, ResidualCurves } from '@/data/schemas';
import { toScaledInteger } from './rounding';

const PPM = 1_000_000;
type MarketInput = Pick<Asset, 'category' | 'condition' | 'usage'> & {
  firstLeaseListPriceCents: number;
  ageMonths: number;
};

/** Count completed calendar months from the first lease start, or 1 July of the model year. */
export function marketAgeMonths(firstStartOn: string | null, modelYear: number, today: string) {
  const origin = firstStartOn ?? `${modelYear}-07-01`;
  const months =
    (Number(today.slice(0, 4)) - Number(origin.slice(0, 4))) * 12 +
    Number(today.slice(5, 7)) -
    Number(origin.slice(5, 7));
  return Math.max(0, months - Number(today.slice(8, 10) < origin.slice(8, 10)));
}

/** Keep the interpolation as a fraction and round once, half up, when it becomes cents. */
export function marketValueCents(input: MarketInput, curves: ResidualCurves) {
  const points = curves.curves[input.category].toSorted(([a], [b]) => a - b);
  const [firstAge, lowerPercent] = points[0]!;
  let lowerAge = firstAge;
  let curveNumerator = toScaledInteger(lowerPercent, 10_000);
  let curveDenominator = 1;
  for (const [upperAge, upperPercent] of points.slice(1)) {
    if (input.ageMonths <= lowerAge) break;
    const upperPpm = toScaledInteger(upperPercent, 10_000);
    if (input.ageMonths < upperAge) {
      curveDenominator = upperAge - lowerAge;
      curveNumerator =
        curveNumerator * (upperAge - input.ageMonths) + upperPpm * (input.ageMonths - lowerAge);
      break;
    }
    lowerAge = upperAge;
    curveNumerator = upperPpm;
  }

  const rule = curves.usage_adjustment[input.category];
  if (rule.unit !== input.usage.unit) return { ok: false, reason: 'usage_unit_mismatch' } as const;
  const usageAdjustmentPpm = Math.max(
    toScaledInteger(rule.max_total_percent, 10_000),
    Math.floor(input.usage.value / rule.step) * toScaledInteger(rule.percent_per_step, 10_000)
  );
  const conditionPpm = toScaledInteger(curves.condition_multiplier[input.condition], PPM);
  const numerator =
    BigInt(input.firstLeaseListPriceCents) *
    BigInt(curveNumerator) *
    BigInt(conditionPpm) *
    BigInt(PPM + usageAdjustmentPpm);
  const denominator = BigInt(curveDenominator) * BigInt(PPM) ** 3n;
  return {
    ok: true,
    priceCents: Number((numerator + denominator / 2n) / denominator),
    breakdown: {
      ageMonths: input.ageMonths,
      firstLeaseListPriceCents: input.firstLeaseListPriceCents,
      curvePercent: curveNumerator / curveDenominator / 10_000,
      conditionMultiplier: conditionPpm / PPM,
      usagePercent: usageAdjustmentPpm / 10_000,
      rounding: 'half_up' as const,
    },
  } as const;
}

/** The next lease finances market value with no markup. */
export function nextLifeListPriceCents(
  input: MarketInput,
  curves: ResidualCurves,
  table: CoefficientTable
) {
  const result = marketValueCents(input, curves);
  if (!result.ok) return result;
  const floor = Math.min(...table.bands.map((band) => band.min_financed_cents));
  return result.priceCents < floor
    ? ({ ...result, ok: false, reason: 'below_minimum' } as const)
    : result;
}
