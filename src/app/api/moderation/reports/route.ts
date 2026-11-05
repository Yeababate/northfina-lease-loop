import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { requirePrincipal } from '@/server/mock-users';
import { listModerationReports } from '@/server/rating-moderation';
export const GET = handleRoute(async (request) => {
  const principal = await requirePrincipal(db, request);
  return ok(
    await listModerationReports(
      db,
      principal.id,
      new URL(request.url).searchParams.get('all') === '1'
    )
  );
});
