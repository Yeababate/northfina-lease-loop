import { z } from 'zod';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { requirePrincipal } from '@/server/mock-users';
import { listOwnRatingReports, submitRatingReport } from '@/server/rating-reports';
const schema = z
  .object({
    expectedRevision: z.number().int().positive(),
    reason: z.string(),
    explanation: z.string().default(''),
  })
  .strict();
export const POST = handleRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal(db, request);
  const [{ id }, input] = await Promise.all([context.params, readJsonBody(request, schema)]);
  return ok(await submitRatingReport(db, principal.id, id, input));
});
export const GET = handleRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal(db, request);
  const { id } = await context.params;
  return ok(
    (await listOwnRatingReports(db, principal.id)).filter((report) => report.ratingId === id)
  );
});
