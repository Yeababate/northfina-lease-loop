import { z } from 'zod';
import { discountRuleInputSchema } from '@/domain/discounts';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { saveDiscountRule } from '@/server/discount-rules';
import { requireProvider } from '@/server/providers';

const schema = z.strictObject({
  rule: discountRuleInputSchema,
  revision: z.number().int().positive(),
});
export const PATCH = handleRoute(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const provider = await requireProvider(db, request);
    const { id } = await params;
    const { rule, revision } = await readJsonBody(request, schema);
    return ok(await saveDiscountRule(db, provider.id, rule, { id, revision }));
  }
);
