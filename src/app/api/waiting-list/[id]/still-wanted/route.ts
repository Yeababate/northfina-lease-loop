// POST /api/waiting-list/:id/still-wanted — the customer's answer to "Do you still want
// this?" after their needed-by date passed. Body: { answer: "yes", neededBy } to stay on the
// list with a new date (strictly after today), or { answer: "no" } to leave it.
import { z } from 'zod';
import { isoDateSchema } from '@/data/schemas';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { requirePrincipal } from '@/server/mock-users';
import { todayIso } from '@/server/today';
import { answerStillWanted } from '@/server/waiting-list-follow-up';

const schema = z.discriminatedUnion('answer', [
  z.strictObject({ answer: z.literal('yes'), neededBy: isoDateSchema }),
  z.strictObject({ answer: z.literal('no') }),
]);

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/waiting-list/[id]/still-wanted'>) => {
    const { id } = await params;
    const [principal, body] = await Promise.all([
      requirePrincipal(db, request),
      readJsonBody(request, schema),
    ]);
    return ok(await answerStillWanted(db, principal.id, id, body, todayIso()));
  }
);
