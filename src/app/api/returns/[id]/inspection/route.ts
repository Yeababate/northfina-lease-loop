// POST /api/returns/:id/inspection
// body: { expectedRevision, condition, usageValue, hoursSinceService: number | null }
import { z } from 'zod';
import { assetConditionSchema } from '@/data/schemas';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { recordInspection } from '@/server/next-life-commands';
import { requireProvider } from '@/server/providers';
import { todayIso } from '@/server/today';

const count = z.number().int().nonnegative().max(10_000_000);
const schema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  condition: assetConditionSchema,
  usageValue: count,
  hoursSinceService: count.nullable(),
});

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/returns/[id]/inspection'>) => {
    const { id } = await params;
    const provider = await requireProvider(db, request);
    const body = await readJsonBody(request, schema);
    return ok(await recordInspection(db, provider.id, id, body, todayIso()), { status: 201 });
  }
);
