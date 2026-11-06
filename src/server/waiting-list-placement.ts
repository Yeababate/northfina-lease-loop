// A named waiting-list placement may accept fair condition. It keeps its hold until the
// recipient signs; a public listing never inherits that exception.
import { assetConditionSchema, type CoefficientTable } from '@/data/schemas';
import { quoteLease } from '@/domain/pricing';
import { ApiError } from './api-response';
import type { TransactionClient } from './audit';
import type { PrismaClient } from './prisma-client';

type Reader = PrismaClient | TransactionClient;

export async function activePlacement(db: Reader, assetId: string, today: string) {
  return db.waitingListEntry.findFirst({
    where: { offeredAssetId: assetId, status: 'offered', neededBy: { gte: today } },
  });
}

export async function placementBlocksViewer(
  db: Reader,
  assetId: string,
  viewerId: string | null,
  today: string
) {
  const offer = await activePlacement(db, assetId, today);
  if (offer) return offer.participantId === null || offer.participantId !== viewerId;
  const asset = await db.asset.findUnique({
    where: { id: assetId },
    select: { condition: true, status: true },
  });
  return (
    asset?.status === 'available' && (asset.condition === 'fair' || asset.condition === 'poor')
  );
}

/** Called only inside the provider's audited relisting transaction. */
export async function placementForRelisting(
  tx: TransactionClient,
  input: {
    assetId: string;
    intakeId: string;
    providerId: string;
    entryId?: string;
    renterId?: string;
  },
  today: string
) {
  if (!input.entryId) {
    if (input.renterId) throw new ApiError(422, 'ENTRY_REQUIRED', 'Choose a waiting-list offer');
    return null;
  }
  const offer = await activePlacement(tx, input.assetId, today);
  if (!offer || offer.id !== input.entryId || offer.offeredIntakeId !== input.intakeId)
    throw new ApiError(409, 'OFFER_CHANGED', 'This waiting-list offer is no longer available');
  // Imported data-pack entries have no account. The provider must identify their renter;
  // an entry created by a customer can never be reassigned to another person.
  const renterId = offer.participantId ?? input.renterId;
  if (
    !renterId ||
    (input.renterId && input.renterId !== renterId) ||
    renterId === input.providerId ||
    !(await tx.demoUser.findUnique({ where: { id: renterId } }))
  )
    throw new ApiError(
      422,
      'OFFER_RECIPIENT_REQUIRED',
      'Identify the customer who accepts this offer'
    );
  return {
    ...offer,
    participantId: renterId,
    minimum: assetConditionSchema.parse(offer.minCondition),
  };
}

export function checkPlacementBudget(
  offer: { preferredTermMonths: number; maxMonthlyNetRentCents: number },
  priceCents: number,
  table: CoefficientTable
) {
  const quote = quoteLease(table, {
    listPriceCents: priceCents,
    downPaymentCents: 0,
    termMonths: offer.preferredTermMonths,
    vatRatePercent: 0,
  });
  if (!quote.ok || quote.quote.monthlyNetCents > offer.maxMonthlyNetRentCents)
    throw new ApiError(409, 'OFFER_CHANGED', 'The prepared item no longer fits the offer budget');
}

/** Rechecked during signing in the same transaction as the asset reservation. */
export async function claimPlacement(
  tx: TransactionClient,
  asset: { id: string; condition: string },
  renterId: string | null,
  termMonths: number,
  monthlyNetCents: number,
  today: string
) {
  const offer = await activePlacement(tx, asset.id, today);
  if (!offer) {
    // An expired fair offer must not turn into a public fair listing.
    if (asset.condition === 'fair' || asset.condition === 'poor')
      throw new ApiError(
        409,
        'PLACEMENT_REQUIRED',
        'This item needs a current waiting-list placement'
      );
    return;
  }
  if (!renterId || offer.participantId !== renterId)
    throw new ApiError(409, 'ASSET_ALREADY_OFFERED', 'This item is offered to another customer');
  if (termMonths !== offer.preferredTermMonths || monthlyNetCents > offer.maxMonthlyNetRentCents)
    throw new ApiError(409, 'OFFER_CHANGED', 'Review the lease choice for this waiting-list offer');
  const claimed = await tx.waitingListEntry.updateMany({
    where: { id: offer.id, status: 'offered', participantId: renterId, offeredAssetId: asset.id },
    data: { status: 'matched', offeredAssetId: null },
  });
  if (claimed.count !== 1)
    throw new ApiError(409, 'OFFER_CHANGED', 'The offer changed before signing');
}
