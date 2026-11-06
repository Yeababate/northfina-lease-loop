import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { publicRatings } from '@/server/ratings';

export const GET = handleRoute<{ params: Promise<{ id: string }> }>(async (_request, context) => {
  const { id } = await context.params;
  return ok(await publicRatings(db, id));
});
