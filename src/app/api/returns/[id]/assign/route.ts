import { z } from 'zod';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { requireProvider } from '@/server/providers';
import { todayIso } from '@/server/today';
import { assignWaitingListEntry } from '@/server/waiting-list';

const bodySchema = z.strictObject({ entryId: z.string().min(1) });

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/returns/[id]/assign'>) => {
    const { id } = await params;
    const provider = await requireProvider(db, request);
    const { entryId } = await readJsonBody(request, bodySchema);
    return ok(await assignWaitingListEntry(db, provider.id, id, entryId, todayIso()), {
      status: 201,
    });
  }
);
