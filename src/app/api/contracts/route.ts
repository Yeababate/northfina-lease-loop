import { z } from 'zod';
import { loadCoefficientTable, loadPriceLists } from '@/data/load';
import { centsSchema } from '@/data/schemas';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { signContract } from '@/server/contracts';
import { db } from '@/server/db';
import { todayIso } from '@/server/today';

const schema = z.strictObject({
  assetId: z.string().min(1),
  actor: z.string().trim().min(1).max(100),
  termMonths: z.union([z.literal(12), z.literal(24), z.literal(36), z.literal(48)]),
  downPaymentCents: centsSchema,
  expectedMonthlyNetCents: centsSchema,
  expectedPriceListVersion: z.number().int().positive(),
});

export const POST = handleRoute(async (request) => {
  const input = await readJsonBody(request, schema);
  const [lists, table] = await Promise.all([loadPriceLists(), loadCoefficientTable()]);
  return ok(await signContract(db, input, todayIso(), lists, table), { status: 201 });
});
