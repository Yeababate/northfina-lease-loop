// GET /api/returns/:id — one returned item: stage, required work, records and history.
import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { finalizeDueReturns } from '@/server/next-life-commands';
import { getReturn } from '@/server/next-life-reads';
import { requireProvider } from '@/server/providers';
import { todayIso } from '@/server/today';
import { expireWaitingPlacements } from '@/server/waiting-list-expiry';

export const GET = handleRoute(async (request, { params }: RouteContext<'/api/returns/[id]'>) => {
  const { id } = await params;
  const provider = await requireProvider(db, request);
  await expireWaitingPlacements(db, todayIso());
  await finalizeDueReturns(db, todayIso());
  return ok(await getReturn(db, provider.id, id, todayIso()));
});
