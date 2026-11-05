/** Report submission never changes visibility. Only explicit moderator decisions do. */
export const reportReasons = ['abusive', 'misleading', 'spam', 'other'] as const;
export type ReportReason = (typeof reportReasons)[number];
export type ReportStatus = 'pending' | 'kept' | 'hidden';
export type ModerationAction = 'keep' | 'hide' | 'restore';
export type ModerationPrincipal = { id: string; isModerator: boolean };
export type ModeratedRating = {
  subjectId: string;
  authorId: string;
  revision: number;
  visibility: string;
};

export function canReport(principalId: string | null, rating: ModeratedRating): boolean {
  return (
    principalId !== null && principalId === rating.subjectId && principalId !== rating.authorId
  );
}

export function canModerate(principal: ModerationPrincipal | null): boolean {
  return principal?.isModerator === true;
}

export function validateReport(reason: unknown, explanation: unknown) {
  if (!reportReasons.includes(reason as ReportReason))
    return { ok: false, reason: 'invalid_reason' } as const;
  if (typeof explanation !== 'string' || explanation.trim().length > 2000)
    return { ok: false, reason: 'invalid_explanation' } as const;
  return { ok: true, reason: reason as ReportReason, explanation: explanation.trim() } as const;
}

/** Uniqueness is subject + rating + immutable revision; retries reuse that case. */
export function existingReport<
  T extends { ratingId: string; ratingRevision: number; reporterId: string },
>(
  reports: readonly T[],
  ratingId: string,
  ratingRevision: number,
  reporterId: string
): T | undefined {
  return reports.find(
    (report) =>
      report.ratingId === ratingId &&
      report.ratingRevision === ratingRevision &&
      report.reporterId === reporterId
  );
}

export function moderationTransition(input: {
  action: ModerationAction;
  status: ReportStatus;
  visibility: string;
  reportVersion: number;
  expectedReportVersion: number;
  ratingRevision: number;
  expectedRatingRevision: number;
  moderationVersion: number;
  expectedModerationVersion: number;
  rationale: unknown;
}) {
  if (
    typeof input.rationale !== 'string' ||
    !input.rationale.trim() ||
    input.rationale.trim().length > 2000
  )
    return { ok: false, reason: 'invalid_rationale' } as const;
  if (
    input.reportVersion !== input.expectedReportVersion ||
    input.ratingRevision !== input.expectedRatingRevision ||
    input.moderationVersion !== input.expectedModerationVersion
  )
    return { ok: false, reason: 'stale_context' } as const;
  if (input.action === 'restore') {
    if (input.visibility !== 'hidden') return { ok: false, reason: 'not_hidden' } as const;
    return {
      ok: true,
      status: input.status,
      visibility: 'visible',
      rationale: input.rationale.trim(),
    } as const;
  }
  if (input.status !== 'pending') return { ok: false, reason: 'already_resolved' } as const;
  return {
    ok: true,
    status: input.action === 'hide' ? 'hidden' : 'kept',
    visibility: input.action === 'hide' ? 'hidden' : input.visibility,
    rationale: input.rationale.trim(),
  } as const;
}
