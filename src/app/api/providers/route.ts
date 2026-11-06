import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { listProviders } from '@/server/providers';

/** The same persisted directory used by the Dealer discounts selector. */
export const GET = handleRoute(async () => ok(await listProviders(db)));
