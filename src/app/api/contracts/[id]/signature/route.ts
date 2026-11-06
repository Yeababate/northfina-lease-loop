// POST /api/contracts/:id/signature — the company's named signatory signs a contract that is
// waiting for them (card 6). Sign in with the signatory's email as the demo name first.
import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { requirePrincipal } from '@/server/mock-users';
import { signAsSignatory } from '@/server/signatory';
import { todayIso } from '@/server/today';

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/contracts/[id]/signature'>) => {
    const [{ id }, principal] = await Promise.all([params, requirePrincipal(db, request)]);
    return ok(await signAsSignatory(db, principal, id, todayIso()));
  }
);
