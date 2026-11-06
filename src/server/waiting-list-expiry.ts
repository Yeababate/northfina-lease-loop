import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';

class OfferChanged extends Error {}

/** Expired prepared placements return to inspection stock, never to the public catalogue. */
export async function expireWaitingPlacements(db: PrismaClient, today: string) {
  const offers = await db.waitingListEntry.findMany({
    where: { status: 'offered', neededBy: { lt: today }, offeredAssetId: { not: null } },
  });
  let expired = 0;
  for (const offer of offers) {
    const changed = await withAudit(
      db,
      {
        actor: 'system:waiting-list',
        action: 'waiting_list.offer_expired',
        entityType: 'waiting_list',
        entityId: offer.id,
        details: { assetId: offer.offeredAssetId, on: today },
      },
      async (tx) => {
        const claimed = await tx.waitingListEntry.updateMany({
          where: {
            id: offer.id,
            status: 'offered',
            neededBy: { lt: today },
            offeredAssetId: offer.offeredAssetId,
          },
          data: {
            status: 'expired',
            expiredOn: today,
            expiredReason: 'offer_deadline',
            offeredAssetId: null,
          },
        });
        if (claimed.count !== 1) throw new OfferChanged();
        const intake = offer.offeredIntakeId
          ? await tx.returnIntake.findUnique({
              where: { id: offer.offeredIntakeId },
            })
          : null;
        if (intake?.relistedOn && intake.assetId === offer.offeredAssetId) {
          const released = await tx.asset.updateMany({
            where: { id: intake.assetId, status: 'available' },
            data: { status: 'returned', nextLifePriceCents: null, nextLifePricedOn: null },
          });
          if (released.count === 1)
            await tx.returnIntake.update({
              where: { id: intake.id },
              data: { relistedOn: null, relistedBy: null, revision: { increment: 1 } },
            });
        }
        return true;
      }
    ).catch((error: unknown) => {
      if (error instanceof OfferChanged) return false;
      throw error;
    });
    if (changed) expired++;
  }
  return expired;
}
