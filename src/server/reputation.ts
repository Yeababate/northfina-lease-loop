// Read adapter for ratings shown to customers: a provider's ratings on the item page (so a
// customer can judge whether to lease from them) and your own ratings as a renter on
// "My leases". Only visible ratings are included (publicRatings, src/server/ratings.ts).
import { summarizeRatings, type RatingDirection, type RatingVisibility } from '@/domain/ratings';
import type { PrismaClient } from './prisma-client';
import { publicRatings } from './ratings';

export type Reputation = {
  summary: { count: number; averageTenths: number | null };
  /** Newest first. */
  reviews: {
    id: string;
    stars: number;
    comment: string;
    reviewerName: string;
    createdAt: string;
    edited: boolean;
  }[];
};

export type ProviderReputation = Reputation & { providerId: string; name: string };

/** The owner of an item and what renters have said about them, or null if it has no owner. */
export async function providerReputationForAsset(
  db: PrismaClient,
  assetId: string
): Promise<ProviderReputation | null> {
  const asset = await db.asset.findUnique({ where: { id: assetId }, select: { ownerId: true } });
  if (!asset?.ownerId) return null;
  const [owner, ratings] = await Promise.all([
    db.demoUser.findUnique({ where: { id: asset.ownerId }, select: { displayName: true } }),
    publicRatings(db, asset.ownerId),
  ]);
  return {
    providerId: asset.ownerId,
    name: owner?.displayName ?? asset.ownerId,
    ...pick(ratings, 'renter_to_provider'),
  };
}

/** What providers have said about this person as a renter. */
export async function renterReputation(db: PrismaClient, userId: string): Promise<Reputation> {
  return pick(await publicRatings(db, userId), 'provider_to_renter');
}

function pick(
  ratings: Awaited<ReturnType<typeof publicRatings>>,
  direction: 'renter_to_provider' | 'provider_to_renter'
): Reputation {
  const summary = direction === 'renter_to_provider' ? ratings.asProvider : ratings.asRenter;
  return {
    summary: { count: summary.count, averageTenths: summary.averageTenths },
    reviews: ratings.reviews
      .filter((review) => review.direction === direction)
      .map(({ id, stars, comment, reviewerName, createdAt, edited }) => ({
        id,
        stars,
        comment,
        reviewerName,
        createdAt,
        edited,
      })),
  };
}

export type ProviderBadge = { name: string; count: number; averageTenths: number | null };

/**
 * For catalogue cards: each item's provider name and rating average, for many items at once
 * (three queries in total, not one per card). Items without an owner are left out.
 */
export async function providerBadgesForAssets(
  db: PrismaClient,
  assetIds: readonly string[]
): Promise<Map<string, ProviderBadge>> {
  const assets = await db.asset.findMany({
    where: { id: { in: [...assetIds] } },
    select: { id: true, ownerId: true },
  });
  const ownerIds = [...new Set(assets.flatMap((asset) => (asset.ownerId ? [asset.ownerId] : [])))];
  const [owners, ratings] = await Promise.all([
    db.demoUser.findMany({
      where: { id: { in: ownerIds } },
      select: { id: true, displayName: true },
    }),
    db.rating.findMany({
      where: {
        subjectId: { in: ownerIds },
        direction: 'renter_to_provider',
        visibility: 'visible',
      },
      select: { subjectId: true, direction: true, stars: true, visibility: true },
    }),
  ]);
  const names = new Map(owners.map((owner) => [owner.id, owner.displayName]));
  const rows = ratings.map((rating) => ({
    ...rating,
    direction: rating.direction as RatingDirection,
    visibility: rating.visibility as RatingVisibility,
  }));
  const byOwner = new Map(
    ownerIds.map((id) => [id, summarizeRatings(rows, id, 'renter_to_provider')])
  );

  const badges = new Map<string, ProviderBadge>();
  for (const asset of assets) {
    if (!asset.ownerId) continue;
    const summary = byOwner.get(asset.ownerId);
    badges.set(asset.id, {
      name: names.get(asset.ownerId) ?? asset.ownerId,
      count: summary?.count ?? 0,
      averageTenths: summary?.averageTenths ?? null,
    });
  }
  return badges;
}
