// POST /api/waiting-list — the signed-in customer joins the second-life waiting list.
// Body: { category, maxMonthlyNetRentCents, minCondition, preferredTermMonths, neededBy }.
import { z } from 'zod';
import { loadCoefficientTable } from '@/data/load';
import { assetCategorySchema, assetConditionSchema, isoDateSchema } from '@/data/schemas';
import { availableTerms } from '@/domain/pricing';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { requirePrincipal } from '@/server/mock-users';
import { todayIso } from '@/server/today';
import { joinWaitingList } from '@/server/waiting-list-requests';

const schema = z.strictObject({
  category: assetCategorySchema,
  maxMonthlyNetRentCents: z.number().int(),
  minCondition: assetConditionSchema,
  preferredTermMonths: z.number().int(),
  neededBy: isoDateSchema,
});

export const POST = handleRoute(async (request) => {
  const [principal, body, table] = await Promise.all([
    requirePrincipal(db, request),
    readJsonBody(request, schema),
    loadCoefficientTable(),
  ]);
  const entry = await joinWaitingList(db, principal.id, body, {
    today: todayIso(),
    terms: availableTerms(table),
  });
  return ok(entry, { status: 201 });
});
