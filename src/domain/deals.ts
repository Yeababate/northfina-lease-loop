// Long-term discounts described for customers: which terms are discounted and by how much,
// the best offer for a catalogue badge, and the offer tiers on the Deals page. The rule that
// applies to a term is chosen by monthlyDiscount (./discounts.ts), the same function that
// prices the lease, so what a customer is told always matches the price they get.
import { monthlyDiscount, type RentalDiscountRule } from './discounts';

/** The discount for each offered term, in basis points (0 = none). */
export function termDiscounts(
  rules: readonly RentalDiscountRule[],
  terms: readonly number[]
): { termMonths: number; discountBps: number }[] {
  return terms.map((termMonths) => ({
    termMonths,
    discountBps: monthlyDiscount(0, termMonths, rules).discountBps,
  }));
}

export type BestDeal = { discountBps: number; fromTermMonths: number };

/**
 * The largest discount on offer and the shortest term that gets it, or null when no
 * offered term is discounted. Shown on catalogue cards as "−10% from 24 months".
 */
export function bestDeal(
  rules: readonly RentalDiscountRule[],
  terms: readonly number[]
): BestDeal | null {
  let best: BestDeal | null = null;
  for (const { termMonths, discountBps } of termDiscounts(
    rules,
    [...terms].sort((a, b) => a - b)
  )) {
    if (discountBps > (best?.discountBps ?? 0)) best = { discountBps, fromTermMonths: termMonths };
  }
  return best;
}

export type DealTier = {
  discountBps: number;
  fromTermMonths: number;
  /** Null when the tier runs to the longest offered term ("24 months or longer"). */
  toTermMonths: number | null;
};

/**
 * Consecutive offered terms with the same discount, merged into tiers: e.g. 10 % for 24 and
 * 36 months and 15 % for 48 months gives two tiers. Terms without a discount are left out.
 */
export function dealTiers(
  rules: readonly RentalDiscountRule[],
  terms: readonly number[]
): DealTier[] {
  const sorted = [...terms].sort((a, b) => a - b);
  const longest = sorted.at(-1);
  const tiers: DealTier[] = [];
  let open: { discountBps: number; from: number; to: number } | null = null;
  for (const { termMonths, discountBps } of termDiscounts(rules, sorted)) {
    if (open && open.discountBps === discountBps) {
      open.to = termMonths;
      continue;
    }
    if (open && open.discountBps > 0) tiers.push(close(open, longest));
    open = { discountBps, from: termMonths, to: termMonths };
  }
  if (open && open.discountBps > 0) tiers.push(close(open, longest));
  return tiers;
}

function close(
  tier: { discountBps: number; from: number; to: number },
  longest: number | undefined
): DealTier {
  return {
    discountBps: tier.discountBps,
    fromTermMonths: tier.from,
    toTermMonths: tier.to === longest ? null : tier.to,
  };
}

/**
 * Basis points as a percentage without needless decimals, with the language's decimal
 * sign: 1000 → "10", 1050 → "10.5", 125 → "1.25" (fi: "1,25"). Integer maths only.
 */
export function percentText(discountBps: number, intlLocale: string): string {
  if (!Number.isSafeInteger(discountBps) || discountBps < 0) {
    throw new RangeError(`discountBps must be a non-negative whole number, got ${discountBps}`);
  }
  const whole = Math.floor(discountBps / 100);
  const hundredths = discountBps % 100;
  if (hundredths === 0) return String(whole);
  const separator =
    new Intl.NumberFormat(intlLocale).formatToParts(1.5).find((part) => part.type === 'decimal')
      ?.value ?? '.';
  return `${whole}${separator}${String(hundredths).padStart(2, '0').replace(/0$/, '')}`;
}
