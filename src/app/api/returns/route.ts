// GET /api/returns — the selected provider's returned stock, each with its derived stage,
// hold and blockers. Due leases are finalized first so holds reflect today.
import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { finalizeDueReturns } from '@/server/next-life-commands';
import { listReturns } from '@/server/next-life-reads';
import { requireProvider } from '@/server/providers';
import { todayIso } from '@/server/today';
import { expireWaitingPlacements } from '@/server/waiting-list-expiry';

export const GET = handleRoute(async (request) => {
  const provider = await requireProvider(db, request);
  await expireWaitingPlacements(db, todayIso());
  await finalizeDueReturns(db, todayIso());
  return ok(await listReturns(db, provider.id, todayIso()));
});
