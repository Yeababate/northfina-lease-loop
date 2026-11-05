import { z } from 'zod';
import { divideRoundHalfUp } from './rounding';

export const discountRuleInputSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80),
    minTermMonths: z.number().int().min(1).max(48),
    maxTermMonths: z.number().int().min(1).max(48),
    discountBps: z.number().int().min(1).max(10000),
    enabled: z.boolean(),
  })
  .refine(
    (r) =>
      r.minTermMonths <= r.maxTermMonths &&
      [12, 24, 36, 48].some((term) => term >= r.minTermMonths && term <= r.maxTermMonths),
    { message: 'The range must include an available lease term', path: ['maxTermMonths'] }
  );

export type DiscountRuleInput = z.infer<typeof discountRuleInputSchema>;
export type RentalDiscountRule = DiscountRuleInput & { id: string; revision: number };

/** Highest percentage wins; equal percentages use smallest id. Rules never stack. */
export function monthlyDiscount(
  originalMonthlyNetCents: number,
  termMonths: number,
  rules: readonly RentalDiscountRule[]
) {
  if (!Number.isSafeInteger(originalMonthlyNetCents) || originalMonthlyNetCents < 0)
    throw new RangeError('Nonnegative whole cents required');
  const selected = rules
    .filter((r) => r.enabled && termMonths >= r.minTermMonths && termMonths <= r.maxTermMonths)
    .sort((a, b) => b.discountBps - a.discountBps || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  if (
    selected &&
    (!Number.isSafeInteger(selected.discountBps) ||
      selected.discountBps < 1 ||
      selected.discountBps > 10000)
  )
    throw new RangeError('Discount must be 1–10000 basis points');
  // The base rent is already rounded by quoteLease. Round the discount once, half up.
  const monthlyDiscountCents = divideRoundHalfUp(
    originalMonthlyNetCents * (selected?.discountBps ?? 0),
    10000
  );
  return {
    originalMonthlyNetCents,
    monthlyDiscountCents,
    monthlyNetCents: originalMonthlyNetCents - monthlyDiscountCents,
    discountBps: selected?.discountBps ?? 0,
    discountRuleId: selected?.id ?? null,
    discountRuleRevision: selected?.revision ?? null,
  };
}
