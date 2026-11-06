import { loadCoefficientTable } from '@/data/load';
import { dealerDiscountInputSchema } from '@/domain/dealer-discount';
import { availableTerms } from '@/domain/pricing';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { dealerDiscountView, saveDealerDiscount } from '@/server/dealer-discount';
import { db } from '@/server/db';
import { requireProvider } from '@/server/providers';

export const GET = handleRoute(async (request) => {
  const provider = await requireProvider(db, request);
  const table = await loadCoefficientTable();
  return ok(await dealerDiscountView(db, provider.id, table));
});
export const PUT = handleRoute(async (request) => {
  const provider = await requireProvider(db, request);
  const input = await readJsonBody(request, dealerDiscountInputSchema);
  const table = await loadCoefficientTable();
  await saveDealerDiscount(db, provider.id, input, availableTerms(table));
  return ok(await dealerDiscountView(db, provider.id, table));
});
