import { randomUUID } from 'node:crypto';
import { canReport, validateReport } from '@/domain/moderation';
import { ApiError } from './api-response';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';

const ownReportSelect = {
  id: true,
  ratingId: true,
  ratingRevision: true,
  reason: true,
  explanation: true,
  status: true,
  createdAt: true,
} as const;

export async function submitRatingReport(
  db: PrismaClient,
  actorId: string,
  ratingId: string,
  input: { expectedRevision: number; reason: unknown; explanation?: unknown }
) {
  const valid = validateReport(
    input.reason,
    input.explanation === undefined ? '' : input.explanation
  );
  if (!valid.ok || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)
    throw new ApiError(422, 'INVALID_REPORT', 'The report is not valid');
  const principal = await db.demoUser.findUnique({ where: { id: actorId } });
  if (!principal) throw new ApiError(401, 'LOGIN_REQUIRED', 'Select a demo username first');
  const rating = await db.rating.findUnique({ where: { id: ratingId } });
  if (!rating) throw new ApiError(404, 'RATING_NOT_FOUND', 'Rating not found');
  if (
    !canReport(principal.id, {
      ...rating,
      authorId: rating.reviewerId,
      revision: rating.currentRevision,
    })
  )
    throw new ApiError(403, 'SUBJECT_REQUIRED', 'Only the rated person can report this rating');
  const key = { ratingId, ratingRevision: input.expectedRevision, reporterId: principal.id };
  const existing = await db.ratingReport.findUnique({
    where: { ratingId_ratingRevision_reporterId: key },
    select: ownReportSelect,
  });
  if (existing) return existing;
  const id = randomUUID();
  try {
    return await withAudit(
      db,
      {
        actor: principal.id,
        action: 'rating.reported',
        entityType: 'rating_report',
        entityId: id,
        details: { ratingId, ratingRevision: input.expectedRevision, reason: valid.reason },
      },
      async (tx) => {
        const current = await tx.rating.findUnique({ where: { id: ratingId } });
        if (!current || current.currentRevision !== input.expectedRevision)
          throw new ApiError(409, 'STALE_CONTEXT', 'Refresh the rating before reporting');
        const revision = await tx.ratingRevision.findUniqueOrThrow({
          where: { ratingId_revision: { ratingId, revision: input.expectedRevision } },
        });
        return tx.ratingReport.create({
          data: {
            id,
            ...key,
            revisionId: revision.id,
            reason: valid.reason,
            explanation: valid.explanation,
          },
          select: ownReportSelect,
        });
      }
    );
  } catch (error) {
    // The unique key handles concurrent retries; the losing transaction (including audit) rolls back.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      const duplicate = await db.ratingReport.findUnique({
        where: { ratingId_ratingRevision_reporterId: key },
        select: ownReportSelect,
      });
      if (duplicate) return duplicate;
    }
    throw error;
  }
}

/** This projection intentionally excludes reporter IDs, moderator notes and decision actors. */
export async function listOwnRatingReports(db: PrismaClient, actorId: string) {
  const principal = await db.demoUser.findUnique({ where: { id: actorId } });
  if (!principal) throw new ApiError(401, 'LOGIN_REQUIRED', 'Select a demo username first');
  return db.ratingReport.findMany({
    where: { reporterId: principal.id },
    select: ownReportSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
}

/** Safe subject-facing projection for server consumers; dates serialize to ISO in JSON. */
export type OwnRatingReport = Awaited<ReturnType<typeof listOwnRatingReports>>[number];
export type SubmitRatingReportInput = Parameters<typeof submitRatingReport>[3];
