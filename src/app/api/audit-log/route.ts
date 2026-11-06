// GET /api/audit-log: the 50 newest audit rows, newest first.
// Optional query: ?entityType=contract&entityId=… narrows the trail to one entity.
import { z } from 'zod';
import { fail, handleRoute, ok } from '@/server/api-response';
import { listAuditLog } from '@/server/audit';
import { db } from '@/server/db';

const filterSchema = z.strictObject({
  entityType: z.string().trim().min(1).max(60).optional(),
  entityId: z.string().trim().min(1).max(200).optional(),
});

export const GET = handleRoute(async (request) => {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const filter = filterSchema.safeParse(query);
  if (!filter.success) return fail(400, 'INVALID_FILTER', 'Unsupported audit filter');
  return ok(await listAuditLog(db, 50, 'public', filter.data));
});
