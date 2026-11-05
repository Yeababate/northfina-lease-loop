import { randomUUID } from 'node:crypto';
import type { CoefficientTable, PriceList } from '@/data/schemas';
import { priceContract, type PricingInput } from '@/domain/pricing';
import { ApiError } from './api-response';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';

/** No update operation is exposed: signing creates an immutable price snapshot. */
export async function signContract(
  db: PrismaClient,
  input: PricingInput & {
    actor: string;
    expectedMonthlyNetCents: number;
    expectedPriceListVersion: number;
  },
  signedOn: string,
  lists: readonly PriceList[],
  table: CoefficientTable
) {
  const result = priceContract(
    lists,
    table,
    {
      assetId: input.assetId,
      termMonths: input.termMonths,
      downPaymentCents: input.downPaymentCents,
    },
    signedOn
  );
  if (!result.ok)
    throw new ApiError(422, 'INVALID_PRICE', 'This lease cannot be priced', result.reason);
  if (
    result.price.monthlyNetCents !== input.expectedMonthlyNetCents ||
    result.price.priceListVersion !== input.expectedPriceListVersion
  )
    throw new ApiError(
      409,
      'PRICE_CHANGED',
      'The price changed. Refresh and review before signing'
    );
  const id = randomUUID();
  return withAudit(
    db,
    {
      actor: input.actor,
      action: 'contract.signed',
      entityType: 'contract',
      entityId: id,
      details: result.price,
    },
    async (tx) => {
      const asset = await tx.asset.findUnique({ where: { id: input.assetId } });
      if (!asset) throw new ApiError(404, 'ASSET_NOT_FOUND', 'Asset not found');
      const reserved = await tx.asset.updateMany({
        where: { id: input.assetId, status: 'available' },
        data: { status: 'reserved' },
      });
      if (reserved.count !== 1)
        throw new ApiError(409, 'ASSET_UNAVAILABLE', 'Asset is unavailable');
      return tx.contract.create({ data: { id, actor: input.actor, ...result.price } });
    }
  );
}
