// POST /api/outgoing/contracts/:id/receipt — the contract's provider records that the item
// is physically back. Early receipt holds the item until the lease's exclusive end.
import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { recordReceipt } from '@/server/next-life-commands';
import { requireProvider } from '@/server/providers';
import { todayIso } from '@/server/today';

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/outgoing/contracts/[id]/receipt'>) => {
    const { id } = await params;
    const provider = await requireProvider(db, request);
    return ok(await recordReceipt(db, provider.id, id, todayIso()), { status: 201 });
  }
);
