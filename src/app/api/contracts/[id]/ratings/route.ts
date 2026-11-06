import { z } from 'zod';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { requirePrincipal } from '@/server/mock-users';
import { createRating, ownContractRating } from '@/server/ratings';

const schema = z.strictObject({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
});
type Context = { params: Promise<{ id: string }> };
export const GET = handleRoute<Context>(async (request, context) => {
  const user = await requirePrincipal(db, request);
  const { id } = await context.params;
  return ok(await ownContractRating(db, id, user.id));
});
export const POST = handleRoute<Context>(async (request, context) => {
  const user = await requirePrincipal(db, request);
  const input = await readJsonBody(request, schema);
  const { id } = await context.params;
  return ok(await createRating(db, id, user.id, input), { status: 201 });
});
