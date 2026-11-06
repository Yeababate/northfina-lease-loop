// How a rating average is shown. The average arrives in whole tenths of a star
// (summarizeRatings in ./ratings.ts, rounded once, half up), so 4.5 stars is 45.
import { divideRoundHalfUp } from './rounding';

export const MAX_STARS = 5;

/** Whole stars to fill for an average: 4.4 → 4, 4.5 → 5. Clamped to 0–5. */
export function filledStars(averageTenths: number): number {
  if (!Number.isSafeInteger(averageTenths) || averageTenths < 0) {
    throw new RangeError(`averageTenths must be a non-negative whole number, got ${averageTenths}`);
  }
  return Math.min(MAX_STARS, divideRoundHalfUp(averageTenths, 10));
}

/** The average as text with one decimal, e.g. 45 → "4.5" (en) or "4,5" (fi). */
export function averageText(averageTenths: number, intlLocale: string): string {
  if (!Number.isSafeInteger(averageTenths) || averageTenths < 0) {
    throw new RangeError(`averageTenths must be a non-negative whole number, got ${averageTenths}`);
  }
  const whole = Math.floor(averageTenths / 10);
  const tenth = averageTenths % 10;
  // Built from the two integers, so no floating-point value is ever formatted.
  const separator =
    new Intl.NumberFormat(intlLocale).formatToParts(1.5).find((part) => part.type === 'decimal')
      ?.value ?? '.';
  return `${whole}${separator}${tenth}`;
}
