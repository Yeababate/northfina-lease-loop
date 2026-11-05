import { randomUUID } from 'node:crypto';
import type { Rating } from '@/generated/prisma/client';
import {
  ratingEligibility,
  planRatingEdit,
  summarizeRatings,
  validateRating,
} from '@/domain/ratings';
import type { RatingDirection, RatingVisibility } from '@/domain/ratings';
import { ApiError } from './api-response';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';

export type RatingContent = { stars: number; comment?: string };

async function participantContext(
  db: Pick<PrismaClient, 'contract'>,
  contractId: string,
  userId: string
) {
  const contract = await db.contract.findUnique({
    where: { id: contractId },
    include: { lifecycle: true },
  });
  if (!contract) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'Contract not found');
  const eligibility = ratingEligibility(
    { ...contract, status: contract.lifecycle?.status ?? 'active' },
    userId
  );
  if (!eligibility.ok)
    throw new ApiError(403, 'NOT_ELIGIBLE', 'This rental cannot be reviewed', eligibility.reason);
  return eligibility;
}

/** Public serialization excludes private contract/contact fields. */
export async function publicRatings(db: PrismaClient, subjectId: string) {
  const rows = await db.rating.findMany({
    where: { subjectId, visibility: 'visible' },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  const authors = await db.demoUser.findMany({
    where: { id: { in: rows.map((r) => r.reviewerId) } },
    select: { id: true, displayName: true },
  });
  const names = new Map(authors.map((a) => [a.id, a.displayName]));
  const summaries = rows.map((r) => ({
    ...r,
    direction: r.direction as RatingDirection,
    visibility: r.visibility as RatingVisibility,
  }));
  return {
    asProvider: summarizeRatings(summaries, subjectId, 'renter_to_provider'),
    asRenter: summarizeRatings(summaries, subjectId, 'provider_to_renter'),
    reviews: rows.map((r) => ({
      id: r.id,
      stars: r.stars,
      comment: r.comment,
      direction: r.direction,
      reviewerName: names.get(r.reviewerId) ?? '',
      createdAt: r.createdAt.toISOString(),
      edited: r.currentRevision > 1,
      currentRevision: r.currentRevision,
    })),
  };
}

export async function createRating(
  db: PrismaClient,
  contractId: string,
  userId: string,
  input: RatingContent
) {
  const content = validateRating(input.stars, input.comment ?? '');
  if (!content.ok)
    throw new ApiError(422, 'INVALID_RATING', 'A valid rating is required', content.reason);
  const id = randomUUID();
  try {
    return await withAudit(
      db,
      { actor: userId, action: 'rating.created', entityType: 'rating', entityId: id },
      async (tx) => {
        const relationship = await participantContext(tx, contractId, userId);
        return tx.rating.create({
          data: {
            id,
            contractId,
            reviewerId: userId,
            subjectId: relationship.subjectId,
            direction: relationship.direction,
            stars: content.stars,
            comment: content.comment,
            revisions: {
              create: {
                id: randomUUID(),
                revision: 1,
                stars: content.stars,
                comment: content.comment,
                authorId: userId,
              },
            },
          },
        });
      }
    );
  } catch (error) {
    if (isUniqueConflict(error))
      throw new ApiError(409, 'RATING_EXISTS', 'You already reviewed this rental');
    throw error;
  }
}

export async function editRating(
  db: PrismaClient,
  id: string,
  userId: string,
  input: RatingContent & { expectedRevision: number }
) {
  return withAudit(
    db,
    { actor: userId, action: 'rating.edited', entityType: 'rating', entityId: id },
    async (tx) => {
      const current = await tx.rating.findUnique({ where: { id } });
      if (!current) throw new ApiError(404, 'RATING_NOT_FOUND', 'Rating not found');
      const edit = planRatingEdit(
        { ...current, visibility: current.visibility as RatingVisibility },
        userId,
        input.expectedRevision,
        input.stars,
        input.comment ?? ''
      );
      if (!edit.ok)
        throw new ApiError(
          edit.reason === 'stale_revision' ? 409 : edit.reason === 'not_author' ? 403 : 422,
          'RATING_EDIT_REJECTED',
          'This rating cannot be edited',
          edit.reason
        );
      const updated = await tx.rating.updateMany({
        where: { id, reviewerId: userId, currentRevision: input.expectedRevision },
        data: { stars: edit.stars, comment: edit.comment, currentRevision: edit.currentRevision },
      });
      if (updated.count !== 1)
        throw new ApiError(409, 'STALE_RATING', 'Refresh this rating before editing');
      await tx.ratingRevision.create({
        data: {
          id: randomUUID(),
          ratingId: id,
          revision: edit.currentRevision,
          stars: edit.stars,
          comment: edit.comment,
          authorId: userId,
        },
      });
      return tx.rating.findUniqueOrThrow({ where: { id } });
    }
  );
}

export async function ownContractRating(
  db: PrismaClient,
  contractId: string,
  userId: string
): Promise<Rating | null> {
  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract || (contract.renterId !== userId && contract.providerId !== userId))
    throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'Contract not found');
  return db.rating.findUnique({
    where: { contractId_reviewerId: { contractId, reviewerId: userId } },
  });
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
