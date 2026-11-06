import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { requireProvider } from '@/server/providers';
import { todayIso } from '@/server/today';
import { getWaitingListMatches } from '@/server/waiting-list';

export const GET = handleRoute(
  async (request, { params }: RouteContext<'/api/returns/[id]/matches'>) => {
    const { id } = await params;
    const provider = await requireProvider(db, request);
    return ok(await getWaitingListMatches(db, provider.id, id, todayIso()));
  }
);
