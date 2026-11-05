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

/** Prototype only: replace this implementation when the final policy is agreed.
 * Half-cent fees round once, half up, using the application's shared monetary rule.
 * elapsedMonths is intentionally accepted for the future time-dependent policy.
 */
export function calculateEarlyCancellationFee(input: EarlyExitPriceInput): number {
  return divideRoundHalfUp(remainingRent(input), 2);
}

/** A separate replaceable policy: cancellation fees are never added to ownership price. */
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
