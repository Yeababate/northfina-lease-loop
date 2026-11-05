// POST /api/returns/:id/relist — body: { expectedRevision }
// Makes a ready item available again at its existing catalogue price. Refused with
// NOT_READY (details = blocker codes) while anything is outstanding.
import { z } from 'zod';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { relist } from '@/server/next-life-commands';
import { requireProvider } from '@/server/providers';
import { todayIso } from '@/server/today';

const schema = z.strictObject({ expectedRevision: z.number().int().nonnegative() });

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/returns/[id]/relist'>) => {
    const { id } = await params;
    const provider = await requireProvider(db, request);
    const body = await readJsonBody(request, schema);
    return ok(await relist(db, provider.id, id, body, todayIso()));
  }
);
