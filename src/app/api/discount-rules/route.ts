import { discountRuleInputSchema } from '@/domain/discounts';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { saveDiscountRule } from '@/server/discount-rules';
import { requireProvider } from '@/server/providers';

export const GET = handleRoute(async (request) => {
  const provider = await requireProvider(db, request);
  return ok(
    await db.discountRule.findMany({ where: { providerId: provider.id }, orderBy: { id: 'asc' } })
  );
});
export const POST = handleRoute(async (request) => {
  const provider = await requireProvider(db, request);
  const input = await readJsonBody(request, discountRuleInputSchema);
  return ok(await saveDiscountRule(db, provider.id, input), { status: 201 });
});
