// Fair early exit, policy `fair-exit-v2` (issue #43, scenario card 8).
//
// The renter leaves at the end of the current, already earned month (`effectiveEndOn`). From
// that day the provider loses what the rest of the contract would have paid:
//
//   - the r remaining monthly rents R, billed in advance: the first one would have fallen due
//     on effectiveEndOn itself (0 months away), the last one r − 1 months away;
//   - the signed end-of-term buyout B, due on the contract end date, r months away.
//
// Money received early is worth more than money received later, so each payment is
// discounted to effectiveEndOn at the contract band's `annual_interest_percent`, compounded
// monthly at i = annual / 12:
//
//   PV(r) = Σ_{k=0}^{r−1} R / (1 + i)^k  +  B / (1 + i)^r
//
// BUYOUT price  = max(PV(r), B). In the final month r = 0, so it is exactly B, the same price as
//                 the end-of-term buyout. The floor at B means an early buyout never costs less
//                 than waiting for the end, which also keeps the price non-increasing as months
//                 pass for every input (for real contracts, where rent covers the interest on
//                 the buyout, PV(r) ≥ B anyway and the floor never applies).
// RETURN price  = buyout price − market value of the returned item(s), floored at 0. The
//                 provider gets the item back, so its market value (residual curve × condition
//                 × usage, see market-value.ts) is credited. No handling fee is added: the data
//                 pack defines none, and the credit already uses a cautious condition before
//                 inspection (see fair-exit-valuation.ts). So a return never costs more than a
//                 buyout of the same lease in the same month.
//
// ROUNDING: PV(r) is kept as an exact fraction of big integers (no floating point), with
// i = basis points / 120 000, and rounded to cents ONCE, half up, with divideRoundHalfUpBig.
// Every other line (nominal rent, discount, credit, net) is then whole cents, added and
// subtracted exactly, so the lines always add up to the result. VAT is computed on the final
// net once, half up, by vatCents.
import type { ValuedItem } from './fair-exit-valuation';
import { divideRoundHalfUpBig, toScaledInteger } from './rounding';
import { vatCents } from './vat';

export const FAIR_EXIT_METHOD = 'fair-exit-v2';

/** 12 months × 100 % × 100 basis points per percent: i = basisPoints / 120 000 per month. */
const MONTHLY_RATE_DENOMINATOR = 120_000n;

export type FairExitKind = 'return' | 'buyout';

export type FairExitInput = Readonly<{
  kind: FairExitKind;
  monthlyRentCents: number;
  remainingMonths: number;
  endOfTermBuyoutCents: number;
  /** The contract band's annual_interest_percent, e.g. 7.9. Two decimals at most. */
  annualInterestPercent: number;
  /** VAT rate on the exit date, e.g. 26. */
  vatRatePercent: number;
  /** Return only: what the returned items are worth on the exit date (fair-exit-valuation). */
  valuation?: Readonly<{ marketValueCents: number; items: readonly ValuedItem[] }>;
}>;

/** Every step of a v2 quote, in cents, in the order the UI shows them. */
export type FairExitBreakdown = {
  remainingMonths: number;
  monthlyRentCents: number;
  /** remainingMonths × monthlyRentCents: what the rest of the lease would have cost. */
  nominalRemainingRentCents: number;
  endOfTermBuyoutCents: number;
  annualInterestPercent: number;
  /** Nominal rent + buyout − present value: the benefit of paying it all now. ≥ 0. */
  discountCents: number;
  /** max(PV(r), B): the early buyout price, net. */
  buyoutValueCents: number;
  /** Return only (0 for a buyout): the returned items' market value on the exit date. */
  marketValueCents: number;
  /** Return only: how each returned item was valued (empty for a buyout). */
  valuedItems: readonly ValuedItem[];
  /** min(market value, buyout value): the part of the market value actually credited. */
  marketValueCreditCents: number;
  netCents: number;
  vatRatePercent: number;
  vatCents: number;
  grossCents: number;
};

function cents(value: number, name: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be non-negative safe integer cents, got ${value}`);
  }
  return BigInt(value);
}

function toSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Amount exceeds safe cents');
  return Number(value);
}

/**
 * PV(r) in whole cents, rounded once, half up. Kept exact as numerator / denominator: going one
 * month further from the end, PV(r) = R + PV(r − 1) × q / d with q = 120 000 and
 * d = 120 000 + basis points, so the denominator is d^r. Numbers grow to a few thousand digits
 * for the longest supported term (1 200 months), which BigInt handles exactly.
 */
export function presentValueCents(
  input: Pick<
    FairExitInput,
    'monthlyRentCents' | 'remainingMonths' | 'endOfTermBuyoutCents' | 'annualInterestPercent'
  >
): number {
  const rent = cents(input.monthlyRentCents, 'monthlyRentCents');
  const buyout = cents(input.endOfTermBuyoutCents, 'endOfTermBuyoutCents');
  if (
    !Number.isSafeInteger(input.remainingMonths) ||
    input.remainingMonths < 0 ||
    input.remainingMonths > 1200
  ) {
    throw new RangeError('remainingMonths must be a whole number from 0 to 1200');
  }
  if (!Number.isFinite(input.annualInterestPercent) || input.annualInterestPercent < 0) {
    throw new RangeError('annualInterestPercent must be non-negative');
  }
  const basisPoints = BigInt(toScaledInteger(input.annualInterestPercent, 100));
  const q = MONTHLY_RATE_DENOMINATOR;
  const d = MONTHLY_RATE_DENOMINATOR + basisPoints;
  let numerator = buyout;
  let denominator = 1n;
  for (let month = 0; month < input.remainingMonths; month++) {
    numerator = rent * denominator * d + numerator * q;
    denominator *= d;
  }
  return toSafeNumber(divideRoundHalfUpBig(numerator, denominator));
}

/** The v2 price of an early return or buyout, with every step. See the header comment. */
export function fairExitPrice(input: FairExitInput): FairExitBreakdown {
  const presentValue = presentValueCents(input);
  const nominal = input.monthlyRentCents * input.remainingMonths;
  if (!Number.isSafeInteger(nominal + input.endOfTermBuyoutCents)) {
    throw new RangeError('Remaining rent exceeds safe cents');
  }
  const buyoutValue = Math.max(presentValue, input.endOfTermBuyoutCents);
  let marketValue = 0;
  if (input.kind === 'return') {
    if (input.valuation === undefined) {
      throw new RangeError('A return needs the market value of the returned items');
    }
    marketValue = toSafeNumber(cents(input.valuation.marketValueCents, 'marketValueCents'));
  }
  const credit = Math.min(marketValue, buyoutValue);
  const net = buyoutValue - credit;
  const vat = vatCents(net, input.vatRatePercent);
  return {
    remainingMonths: input.remainingMonths,
    monthlyRentCents: input.monthlyRentCents,
    nominalRemainingRentCents: nominal,
    endOfTermBuyoutCents: input.endOfTermBuyoutCents,
    annualInterestPercent: input.annualInterestPercent,
    discountCents: nominal + input.endOfTermBuyoutCents - buyoutValue,
    buyoutValueCents: buyoutValue,
    marketValueCents: marketValue,
    valuedItems: input.kind === 'return' ? [...(input.valuation?.items ?? [])] : [],
    marketValueCreditCents: credit,
    netCents: net,
    vatRatePercent: input.vatRatePercent,
    vatCents: vat,
    grossCents: net + vat,
  };
}

/** Field-by-field equality, so a stale breakdown (e.g. a new VAT rate) needs a fresh preview. */
export function sameBreakdown(a: FairExitBreakdown | undefined, b: FairExitBreakdown | undefined) {
  if (a === undefined || b === undefined) return a === b;
  const keys = Object.keys(a) as (keyof FairExitBreakdown)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) =>
    key === 'valuedItems'
      ? a.valuedItems.length === b.valuedItems.length &&
        a.valuedItems.every((item, index) => sameValuedItem(item, b.valuedItems[index]))
      : a[key] === b[key]
  );
}

function sameValuedItem(a: ValuedItem, b: ValuedItem | undefined) {
  return (
    b !== undefined &&
    a.assetId === b.assetId &&
    a.basis === b.basis &&
    a.condition === b.condition &&
    a.usageUnit === b.usageUnit &&
    a.usageValue === b.usageValue &&
    a.ageMonths === b.ageMonths &&
    a.marketValueCents === b.marketValueCents
  );
}
