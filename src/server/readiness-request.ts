// Shared parsing and data loading for the readiness routes (#51).
import { z } from 'zod';
import { loadCoefficientTable, loadPriceLists, loadQuestions, loadVatRates } from '@/data/load';
import { centsSchema } from '@/data/schemas';
import type { ReadinessData } from './lease-readiness';
import { requireProfileKey } from './saved-answers';

/** The catalogue's default lease: 36 months, no down payment. */
const querySchema = z.object({
  term: z.coerce
    .number()
    .pipe(z.union([z.literal(12), z.literal(24), z.literal(36), z.literal(48)]))
    .default(36),
  down: z.coerce.number().pipe(centsSchema).default(0),
  profile: z.string().max(40).optional(),
});

export function parseReadinessQuery(url: string) {
  const query = querySchema.parse(Object.fromEntries(new URL(url).searchParams));
  return {
    termMonths: query.term,
    downPaymentCents: query.down,
    profileKey: query.profile === undefined ? null : requireProfileKey(query.profile),
  };
}

export async function loadReadinessData(): Promise<ReadinessData> {
  const [lists, table, vatRates, questionsFile] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
    loadQuestions(),
  ]);
  return { lists, table, vatRates, questions: questionsFile.questions };
}
