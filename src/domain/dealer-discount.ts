import { z } from 'zod';
import type { RentalDiscountRule } from './discounts';

export type StoredDiscountRule = RentalDiscountRule & { archived?: boolean };
export const dealerDiscountInputSchema = z.strictObject({
  minTermMonths: z.number().int().positive(),
  discountBps: z.number().int().min(1).max(10000),
  enabled: z.boolean(),
  expectedRules: z
    .array(z.strictObject({ id: z.string().min(1), revision: z.number().int().positive() }))
    .max(1000),
  confirmReplacement: z.boolean().default(false),
});
export type DealerDiscountInput = z.infer<typeof dealerDiscountInputSchema>;

/** An optimistic lock covering the whole current setting, including disabled legacy rows. */
export function discountRevisionKey(rules: readonly { id: string; revision: number }[]) {
  return JSON.stringify(
    rules
      .map((r) => [r.id, r.revision])
      .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0))
  );
}

/** Never silently widen a bounded offer or combine several saved offers. */
export function dealerDiscountSetting(
  rules: readonly StoredDiscountRule[],
  terms: readonly number[]
) {
  const current = rules.filter((rule) => !rule.archived);
  const single = current.length === 1 ? current[0]! : null;
  const simple =
    single !== null &&
    terms.includes(single.minTermMonths) &&
    single.maxTermMonths >= Math.max(...terms);
  return {
    mode: current.length === 0 ? 'empty' : simple ? 'simple' : 'legacy',
    ruleId: simple ? single.id : null,
    minTermMonths:
      single && terms.includes(single.minTermMonths)
        ? single.minTermMonths
        : (terms.find((term) => term >= 36) ?? terms[0] ?? 36),
    discountBps: single?.discountBps ?? 1000,
    enabled: current.length === 0 ? true : current.some((rule) => rule.enabled),
    expectedRules: current.map(({ id, revision }) => ({ id, revision })),
  } as const;
}

/** Whole-euro slider steps, with a final exact endpoint even when the maximum has cents. */
export function downPaymentAtStep(minimum: number, maximum: number, step: number) {
  if (
    ![minimum, maximum, step].every(Number.isSafeInteger) ||
    minimum < 0 ||
    maximum < minimum ||
    step < 0
  )
    throw new RangeError('Invalid down-payment slider step');
  return Math.min(maximum, minimum + step * 100);
}
