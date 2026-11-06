// POST /api/returns/:id/relist — body: { expectedRevision }
// Makes a ready item available at its second-life price. Refused with NOT_READY while work
// is outstanding, or INVALID_NEXT_LIFE_PRICE when the asset cannot be priced for a new lease.
import { z } from 'zod';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { relist } from '@/server/next-life-commands';
import { requireProvider } from '@/server/providers';
import { todayIso } from '@/server/today';

const schema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  waitingListEntryId: z.string().min(1).optional(),
  renterId: z.string().min(1).optional(),
});

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/returns/[id]/relist'>) => {
    const { id } = await params;
    const provider = await requireProvider(db, request);
    const body = await readJsonBody(request, schema);
    return ok(await relist(db, provider.id, id, body, todayIso()));
  }
);
