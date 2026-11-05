import { z } from 'zod';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { requirePrincipal } from '@/server/mock-users';
import { editRating } from '@/server/ratings';

const schema = z.strictObject({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
  expectedRevision: z.number().int().positive(),
});
export const PATCH = handleRoute<{ params: Promise<{ id: string }> }>(async (request, context) => {
  const user = await requirePrincipal(db, request);
  const input = await readJsonBody(request, schema);
  const { id } = await context.params;
  return ok(await editRating(db, id, user.id, input));
});
