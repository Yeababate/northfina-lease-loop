// The v1 early-exit policies. New quotes use fair-exit-v2 (fair-exit.ts); these stay so that a
// quote stored with a v1 `method` keeps its price and is still explained by the rule it used.
import { divideRoundHalfUp } from './rounding';

export type EarlyExitPriceInput = Readonly<{
  monthlyRentCents: number;
  remainingMonths: number;
  elapsedMonths: number;
}>;

export const CANCELLATION_METHOD = 'half-remaining-rent-v1';
export const BUYOUT_METHOD = 'remaining-rent-plus-buyout-v1';

function remainingRent(input: EarlyExitPriceInput): number {
  for (const value of [input.monthlyRentCents, input.remainingMonths, input.elapsedMonths]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError('Nonnegative safe integers required');
    }
  }
  const amount = input.monthlyRentCents * input.remainingMonths;
  if (!Number.isSafeInteger(amount)) throw new RangeError('Remaining rent exceeds safe cents');
  return amount;
}

/** v1 cancellation: half of the remaining rents. Superseded by fair-exit-v2 for new quotes.
 * Half-cent fees round once, half up, using the application's shared monetary rule.
 */
export function calculateEarlyCancellationFee(input: EarlyExitPriceInput): number {
  return divideRoundHalfUp(remainingRent(input), 2);
}

/** v1 buyout: the remaining rents plus the buyout, undiscounted. Superseded by fair-exit-v2. */
export function calculateEarlyBuyoutPrice(
  input: EarlyExitPriceInput & Readonly<{ endOfTermBuyoutCents: number }>
): number {
  if (!Number.isSafeInteger(input.endOfTermBuyoutCents) || input.endOfTermBuyoutCents < 0) {
    throw new RangeError('Nonnegative safe buyout cents required');
  }
  const amount = remainingRent(input) + input.endOfTermBuyoutCents;
  if (!Number.isSafeInteger(amount)) throw new RangeError('Buyout exceeds safe cents');
  return amount;
}
