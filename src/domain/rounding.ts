// The one rounding rule for money in Lease Loop.
//
// Every amount that is not already whole cents (rent = financed × factor, VAT = net × rate,
// buyout = financed × percent) is rounded ONCE, at the moment it becomes a cent amount,
// half up: 0.5 cent and more goes up, less than 0.5 cent goes down. All our amounts are
// non-negative, so "half up" and "half away from zero" are the same thing here.
//
// To keep that exact, we never multiply cents by a floating-point rate. Rates are first
// turned into whole numbers of a fixed unit (millionths, tenths of a percent), multiplied
// as integers, and divided once with integer rounding.

/** Divides two non-negative integers and rounds half up: 7/2 → 4, 5/3 → 2. */
export function divideRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new RangeError(`numerator must be a non-negative safe integer, got ${numerator}`);
  }
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError(`denominator must be a positive safe integer, got ${denominator}`);
  }
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
}

/**
 * Turns a decimal such as 0.027584 or 25.5 into a whole number of `1 / scale` units:
 * toScaledInteger(0.027584, 1_000_000) → 27584. Throws if the value has more decimals than
 * the scale can hold, because silently dropping digits would change a price.
 */
export function toScaledInteger(value: number, scale: number): number {
  const scaled = Math.round(value * scale);
  // Allow for binary floating-point noise (0.1 × 10 = 1.0000000000000002), nothing more.
  if (Math.abs(scaled - value * scale) > 1e-6) {
    throw new RangeError(`${value} has more precision than 1/${scale}`);
  }
  return scaled;
}
