// Read adapter for the rating line on each "My leases" card: for every lease the customer
// rents, whether they have rated it (and with how many stars) or may rate it now. Read-only;
// the rule is leaseRatingPrompt in src/domain/lease-rating-prompt.ts.
import { leaseRatingPrompt, type LeaseRatingPrompt } from '@/domain/lease-rating-prompt';
import type { PrismaClient } from './prisma-client';

/** Keyed by contract id. Leases the customer only provides are not included. */
export async function myLeaseRatingPrompts(
  db: PrismaClient,
  userId: string
): Promise<Map<string, LeaseRatingPrompt>> {
  const [contracts, ratings] = await Promise.all([
    db.contract.findMany({
      where: { renterId: userId },
      select: {
        id: true,
        renterId: true,
        providerId: true,
        lifecycle: { select: { status: true } },
      },
    }),
    db.rating.findMany({
      where: { reviewerId: userId },
      select: { contractId: true, stars: true },
    }),
  ]);
  const ownStars = new Map(ratings.map((rating) => [rating.contractId, rating.stars]));
  return new Map(
    contracts.map((contract) => [
      contract.id,
      leaseRatingPrompt(
        { ...contract, status: contract.lifecycle?.status ?? 'active' },
        userId,
        ownStars.get(contract.id) ?? null
      ),
    ])
  );
}
