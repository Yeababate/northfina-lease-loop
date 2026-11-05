import { loadVatRates } from '@/data/load';
import {
  parseProfileQuery,
  selectProfileLeases,
  summarizeProfileLeases,
} from '@/domain/profile-leases';
import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { requirePrincipal } from '@/server/mock-users';
import { listParticipantContracts } from '@/server/profile';
import { todayIso } from '@/server/today';

export const GET = handleRoute(async (request) => {
  const user = await requirePrincipal(db, request);
  const [leases, vat] = await Promise.all([listParticipantContracts(db, user.id), loadVatRates()]);
  const today = todayIso();
  const query = parseProfileQuery(Object.fromEntries(new URL(request.url).searchParams));
  return ok(
    {
      user: { id: user.id, displayName: user.displayName },
      today,
      query,
      summary: summarizeProfileLeases(leases, user.id, today, vat.rates),
      incoming: selectProfileLeases(leases, user.id, 'incoming', today, query),
      outgoing: selectProfileLeases(leases, user.id, 'outgoing', today, query),
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
});
