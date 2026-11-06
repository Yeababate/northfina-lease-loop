// GET /api/assets/readiness?ids=ebike-003,laptop-008&term=36&down=0[&profile=consumer]
// Batched lease readiness for the catalogue (#51): one entry per id, in order; an unknown id
// comes back as `not_found`. At most 60 ids per call.
import { z } from 'zod';
import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { readinessForAssets } from '@/server/lease-readiness';
import { principalFromRequest } from '@/server/mock-users';
import { loadReadinessData, parseReadinessQuery } from '@/server/readiness-request';
import { todayIso } from '@/server/today';

const MAX_IDS = 60;
const idsSchema = z
  .string()
  .transform((value) => [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ])
  .pipe(z.array(z.string().max(64)).min(1).max(MAX_IDS));

export const GET = handleRoute(async (request) => {
  const assetIds = idsSchema.parse(new URL(request.url).searchParams.get('ids') ?? '');
  const query = parseReadinessQuery(request.url);
  const principal = await principalFromRequest(db, request);
  return ok(
    await readinessForAssets(
      db,
      principal?.id ?? null,
      { ...query, assetIds },
      todayIso(),
      await loadReadinessData()
    ),
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
});
