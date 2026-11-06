import { randomUUID } from 'node:crypto';
import type { CoefficientTable } from '@/data/schemas';
import {
  dealerDiscountInputSchema,
  dealerDiscountSetting,
  discountRevisionKey,
  type DealerDiscountInput,
} from '@/domain/dealer-discount';
import { availableTerms } from '@/domain/pricing';
import { ApiError } from './api-response';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';

export async function dealerDiscountView(
  db: PrismaClient,
  providerId: string,
  table: CoefficientTable
) {
  const rules = await db.discountRule.findMany({
    where: { providerId, archived: false },
    orderBy: { id: 'asc' },
  });
  const terms = availableTerms(table);
  return {
    rules,
    terms,
    setting: dealerDiscountSetting(rules, terms),
  } as const;
}
export type DealerDiscountView = Awaited<ReturnType<typeof dealerDiscountView>>;

/** One threshold offer; replaced definitions remain archived, never silently widened/deleted. */
export async function saveDealerDiscount(
  db: PrismaClient,
  providerId: string,
  raw: DealerDiscountInput,
  terms: readonly number[]
) {
  const input = dealerDiscountInputSchema.parse(raw);
  if (!terms.includes(input.minTermMonths))
    throw new ApiError(422, 'INVALID_TERM', 'Choose a supported lease term');
  return withAudit(
    db,
    {
      actor: providerId,
      action: 'discount.setting_saved',
      entityType: 'provider',
      entityId: providerId,
      details: input,
    },
    async (tx) => {
      if (!(await tx.provider.findUnique({ where: { id: providerId } })))
        throw new ApiError(401, 'PROVIDER_REQUIRED', 'Select a provider');
      const current = await tx.discountRule.findMany({ where: { providerId, archived: false } });
      if (discountRevisionKey(current) !== discountRevisionKey(input.expectedRules))
        throw new ApiError(409, 'DISCOUNT_CHANGED', 'Reload the saved discount');
      const setting = dealerDiscountSetting(current, terms);
      if (setting.mode === 'legacy' && !input.confirmReplacement)
        throw new ApiError(
          409,
          'REPLACEMENT_REQUIRED',
          'Confirm replacement of existing discounts'
        );
      const values = {
        minTermMonths: input.minTermMonths,
        maxTermMonths: Math.max(...terms),
        discountBps: input.discountBps,
        enabled: input.enabled,
      };
      if (setting.ruleId) {
        const previous = current.find((rule) => rule.id === setting.ruleId)!;
        const changed = await tx.discountRule.updateMany({
          where: { id: setting.ruleId, providerId, revision: previous.revision, archived: false },
          data: { ...values, revision: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw new ApiError(409, 'DISCOUNT_CHANGED', 'Reload the saved discount');
        return tx.discountRule.findUniqueOrThrow({ where: { id: setting.ruleId } });
      }
      if (current.length)
        await tx.discountRule.updateMany({
          where: { providerId, archived: false },
          data: { archived: true, enabled: false, revision: { increment: 1 } },
        });
      return tx.discountRule.create({
        data: { id: randomUUID(), providerId, name: 'long-term', ...values },
      });
    }
  );
}
