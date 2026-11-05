import { randomUUID } from 'node:crypto';
import { discountRuleInputSchema, type DiscountRuleInput } from '@/domain/discounts';
import { ApiError } from './api-response';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';

/** Read current ownership; callers cannot choose another provider's promotions. */
export async function rulesForAsset(
  db: Pick<PrismaClient, 'assetOwnership' | 'discountRule' | 'provider'>,
  assetId: string
) {
  const owner = await db.assetOwnership.findUnique({ where: { assetId } });
  // Unresolved/orphaned links never authorize another provider's promotions.
  return owner && (await db.provider.findUnique({ where: { id: owner.providerId } }))
    ? db.discountRule.findMany({
        where: { providerId: owner.providerId, enabled: true, archived: false },
      })
    : [];
}

export async function saveDiscountRule(
  db: PrismaClient,
  providerId: string,
  input: DiscountRuleInput,
  update?: { id: string; revision: number }
) {
  const rule = discountRuleInputSchema.parse(input);
  const id = update?.id ?? randomUUID();
  return withAudit(
    db,
    {
      actor: providerId,
      action: update ? 'discount.updated' : 'discount.created',
      entityType: 'discountRule',
      entityId: id,
      details: { ...rule, previousRevision: update?.revision ?? null },
    },
    async (tx) => {
      if (!(await tx.provider.findUnique({ where: { id: providerId } })))
        throw new ApiError(401, 'PROVIDER_REQUIRED', 'Select a demo provider first');
      if (!update) return tx.discountRule.create({ data: { id, providerId, ...rule } });
      const existing = await tx.discountRule.findFirst({
        where: { id, providerId, archived: false },
      });
      if (!existing) throw new ApiError(404, 'DISCOUNT_NOT_FOUND', 'Discount rule not found');
      const changed = await tx.discountRule.updateMany({
        where: { id, providerId, revision: update.revision },
        data: { ...rule, revision: { increment: 1 } },
      });
      if (changed.count !== 1)
        throw new ApiError(409, 'DISCOUNT_CHANGED', 'Reload the discount before editing');
      return tx.discountRule.findUniqueOrThrow({ where: { id } });
    }
  );
}
