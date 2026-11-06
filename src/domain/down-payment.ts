// When the customer gets a down-payment slider. The largest allowed down payment keeps the
// financed amount at or above the smallest band (maxDownPaymentCents in ./pricing.ts), so an
// item priced just above that minimum, say €303.00 against €300.00, could only take a few
// euros down. A slider for that adds nothing, so below this range the page shows the fixed
// down payment instead (usually "No down payment needed").

/** The narrowest down-payment range (max − min) that still gets a slider: €50.00. */
export const MIN_DOWN_PAYMENT_RANGE_CENTS = 5000;

export function downPaymentIsAdjustable(minDownCents: number, maxDownCents: number): boolean {
  if (![minDownCents, maxDownCents].every(Number.isSafeInteger) || minDownCents < 0) {
    throw new RangeError('Down-payment limits must be non-negative whole cents');
  }
  return maxDownCents - minDownCents >= MIN_DOWN_PAYMENT_RANGE_CENTS;
}
