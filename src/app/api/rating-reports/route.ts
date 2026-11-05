import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { requirePrincipal } from '@/server/mock-users';
import { listOwnRatingReports } from '@/server/rating-reports';
export const GET = handleRoute(async (request) => {
  const principal = await requirePrincipal(db, request);
  return ok(await listOwnRatingReports(db, principal.id));
});
