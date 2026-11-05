// GET /api/assets/:id/co2-estimate?term=36
// The illustrative "renting instead of buying new" CO2 estimate for one asset and term.
// Read-only. An estimate that cannot be made is a normal answer (`data.ok: false`), not an error.
import { z } from 'zod';
import { fail, handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { estimateAssetImpact } from '@/server/impact';

const querySchema = z.object({ term: z.coerce.number().int().positive().max(600) });

export const GET = handleRoute(
  async (request, { params }: RouteContext<'/api/assets/[id]/co2-estimate'>) => {
    const { id } = await params;
    const { term } = querySchema.parse({ term: new URL(request.url).searchParams.get('term') });

    const impact = await estimateAssetImpact(db, id, term);
    if (!impact.ok && impact.reason === 'asset_not_found') {
      return fail(404, 'ASSET_NOT_FOUND', `No asset with id "${id}"`);
    }
    if (!impact.ok) return fail(503, 'ESTIMATE_UNAVAILABLE', 'The CO2 estimate is not available');
    return ok(impact.result);
  }
);
