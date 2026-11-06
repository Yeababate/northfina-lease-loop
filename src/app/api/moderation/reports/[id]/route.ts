import { z } from 'zod';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { requirePrincipal } from '@/server/mock-users';
import { decideRatingReport, getModerationReport } from '@/server/rating-moderation';
const schema = z
  .object({
    action: z.enum(['keep', 'hide', 'restore']),
    rationale: z.string(),
    expectedReportVersion: z.number().int().nonnegative(),
    expectedRatingRevision: z.number().int().positive(),
    expectedModerationVersion: z.number().int().nonnegative(),
  })
  .strict();
export const GET = handleRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal(db, request);
  return ok(await getModerationReport(db, principal.id, (await context.params).id));
});
export const POST = handleRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal(db, request);
  const [{ id }, input] = await Promise.all([context.params, readJsonBody(request, schema)]);
  return ok(await decideRatingReport(db, principal.id, id, input));
});
