import { randomUUID } from 'node:crypto';
import {
  canModerate,
  moderationTransition,
  type ModerationAction,
  type ReportStatus,
} from '@/domain/moderation';
import { ApiError } from './api-response';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';

export async function requireModerator(db: PrismaClient, actorId: string) {
  const user = await db.demoUser.findUnique({ where: { id: actorId } });
  if (!canModerate(user ? { id: user.id, isModerator: user.moderator } : null))
    throw new ApiError(403, 'MODERATOR_REQUIRED', 'Moderator capability is required');
  return user!;
}

export async function listModerationReports(
  db: PrismaClient,
  actorId: string,
  includeResolved = false
) {
  await requireModerator(db, actorId);
  return db.ratingReport.findMany({
    where: includeResolved ? {} : { status: 'pending' },
    include: { reportedRevision: true, rating: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

export async function getModerationReport(db: PrismaClient, actorId: string, reportId: string) {
  await requireModerator(db, actorId);
  const report = await db.ratingReport.findUnique({
    where: { id: reportId },
    include: {
      reportedRevision: true,
      rating: {
        include: {
          revisions: { orderBy: { revision: 'asc' } },
          reports: {
            include: { decisions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          },
        },
      },
    },
  });
  if (!report) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Report not found');
  return report;
}

export type ModerationInput = {
  action: ModerationAction;
  rationale: string;
  expectedReportVersion: number;
  expectedRatingRevision: number;
  expectedModerationVersion: number;
};

/** Case, whole-rating visibility, append-only decision and audit commit or roll back together. */
export async function decideRatingReport(
  db: PrismaClient,
  actorId: string,
  reportId: string,
  input: ModerationInput
) {
  const moderator = await requireModerator(db, actorId);
  if (
    !['keep', 'hide', 'restore'].includes(input.action) ||
    ![
      input.expectedReportVersion,
      input.expectedRatingRevision,
      input.expectedModerationVersion,
    ].every(Number.isSafeInteger)
  )
    throw new ApiError(422, 'INVALID_DECISION', 'The decision is not valid');
  return withAudit(
    db,
    {
      actor: moderator.id,
      action: `rating.${input.action}`,
      entityType: 'rating_report',
      entityId: reportId,
      details: { ...input },
    },
    async (tx) => {
      const report = await tx.ratingReport.findUnique({
        where: { id: reportId },
        include: { rating: true },
      });
      if (!report) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Report not found');
      const rating = report.rating;
      const transition = moderationTransition({
        ...input,
        status: report.status as ReportStatus,
        visibility: rating.visibility,
        reportVersion: report.version,
        ratingRevision: rating.currentRevision,
        moderationVersion: rating.moderationVersion,
      });
      if (!transition.ok)
        throw new ApiError(
          transition.reason === 'invalid_rationale' ? 422 : 409,
          transition.reason === 'stale_context' ? 'STALE_CONTEXT' : 'INVALID_TRANSITION',
          'Refresh and review the case before deciding'
        );
      const currentRevision = await tx.ratingRevision.findUniqueOrThrow({
        where: { ratingId_revision: { ratingId: rating.id, revision: rating.currentRevision } },
      });
      const updated = await tx.rating.updateMany({
        where: {
          id: rating.id,
          currentRevision: input.expectedRatingRevision,
          moderationVersion: input.expectedModerationVersion,
        },
        data: { visibility: transition.visibility, moderationVersion: { increment: 1 } },
      });
      if (updated.count !== 1)
        throw new ApiError(409, 'STALE_CONTEXT', 'Refresh and review the case before deciding');
      const resolved = await tx.ratingReport.updateMany({
        where: { id: report.id, version: input.expectedReportVersion },
        data: { status: transition.status, version: { increment: 1 } },
      });
      if (resolved.count !== 1)
        throw new ApiError(409, 'STALE_CONTEXT', 'Refresh and review the case before deciding');
      return tx.moderationDecision.create({
        data: {
          id: randomUUID(),
          reportId,
          action: input.action,
          rationale: transition.rationale,
          moderatorId: moderator.id,
          reviewedRevisionId: currentRevision.id,
          moderationVersion: rating.moderationVersion + 1,
          previousVisibility: rating.visibility,
          resultingVisibility: transition.visibility,
        },
      });
    }
  );
}

/** Private capability-scoped contracts for later admin consumers. */
export type ModerationCase = Awaited<ReturnType<typeof getModerationReport>>;
export type ModerationQueueItem = Awaited<ReturnType<typeof listModerationReports>>[number];
export type ModerationDecisionResult = Awaited<ReturnType<typeof decideRatingReport>>;
