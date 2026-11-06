// GET /api/assets/:id/readiness?term=36&down=0[&profile=consumer]
// Can the signed-in user lease this item straight away with their remembered answers, how
// many questions are still missing, or is the outcome already known (#51)? Read-only.
// Signed out, every applicable question is reported missing.
import { fail, handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { readinessForAssets } from '@/server/lease-readiness';
import { principalFromRequest } from '@/server/mock-users';
import { loadReadinessData, parseReadinessQuery } from '@/server/readiness-request';
import { todayIso } from '@/server/today';

export const GET = handleRoute(
  async (request, { params }: RouteContext<'/api/assets/[id]/readiness'>) => {
    const { id } = await params;
    const query = parseReadinessQuery(request.url);
    const principal = await principalFromRequest(db, request);
    const result = await readinessForAssets(
      db,
      principal?.id ?? null,
      { ...query, assetIds: [id] },
      todayIso(),
      await loadReadinessData()
    );
    const [item] = result.items;
    if (!item || item.status === 'not_found')
      return fail(404, 'ASSET_NOT_FOUND', 'Asset not found');
    return ok(
      { profileKey: result.profileKey, ...item },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
);
