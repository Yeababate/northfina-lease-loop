// POST /api/returns/:id/work — body: { expectedRevision, actionId }
// actionId is a rule id from the data pack (e.g. battery_replacement) or upgrade:<from>-><to>.
import { z } from 'zod';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { recordWork } from '@/server/next-life-commands';
import { requireProvider } from '@/server/providers';
import { todayIso } from '@/server/today';

const schema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  actionId: z.string().trim().min(1).max(100),
});

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/returns/[id]/work'>) => {
    const { id } = await params;
    const provider = await requireProvider(db, request);
    const body = await readJsonBody(request, schema);
    return ok(await recordWork(db, provider.id, id, body, todayIso()), { status: 201 });
  }
);
