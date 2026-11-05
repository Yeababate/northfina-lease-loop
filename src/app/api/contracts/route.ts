// POST /api/contracts: sign an approved application. The body carries the lease choice and
// the answers; the server prices the lease and decides the application again before signing.
import { z } from 'zod';
import { loadCoefficientTable, loadPriceLists, loadQuestions, loadVatRates } from '@/data/load';
import { centsSchema, isoDateSchema } from '@/data/schemas';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { signApplication } from '@/server/contracts';
import { db } from '@/server/db';
import { todayIso } from '@/server/today';

/** One answer, as the question types store it. Sizes are capped so a body stays small. */
const answerSchema = z.union([
  z.string().max(500),
  z.number().int().nonnegative(),
  z.array(z.string().max(200)).max(50),
]);

const schema = z.strictObject({
  assetId: z.string().min(1),
  termMonths: z.union([z.literal(12), z.literal(24), z.literal(36), z.literal(48)]),
  downPaymentCents: centsSchema,
  startOn: isoDateSchema,
  answers: z.record(z.string().regex(/^q_[a-z0-9_]+$/), answerSchema),
  expectedMonthlyNetCents: centsSchema,
  expectedBuyoutNetCents: centsSchema,
  expectedPriceListVersion: z.number().int().positive(),
});

export const POST = handleRoute(async (request) => {
  const input = await readJsonBody(request, schema);
  const [lists, table, vatRates, questionsFile] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
    loadQuestions(),
  ]);
  const contract = await signApplication(db, input, todayIso(), {
    lists,
    table,
    vatRates,
    questions: questionsFile.questions,
  });
  return ok(contract, { status: 201 });
});
