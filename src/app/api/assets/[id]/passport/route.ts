import { fail, handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { loadPassport } from '@/server/passport';

export const GET = handleRoute(
  async (_request, { params }: RouteContext<'/api/assets/[id]/passport'>) => {
    const { id } = await params;
    const passport = await loadPassport(db, id);
    return passport ? ok(passport) : fail(404, 'ASSET_NOT_FOUND', 'Asset not found');
  }
);
