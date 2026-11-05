// POST /api/contracts: sign an approved application. The body carries the lease choice and
// the answers; the server prices the lease and decides the application again before signing.
import { z } from 'zod';
import { loadCoefficientTable, loadPriceLists, loadQuestions, loadVatRates } from '@/data/load';
import { centsSchema, isoDateSchema } from '@/data/schemas';
import { FALLBACK_TIME_ZONE } from '@/domain/local-time';
import { defaultReminderPreferences } from '@/domain/reminder-preferences';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { signApplication } from '@/server/contracts';
import { currentCustomer } from '@/server/current-customer';
import { db } from '@/server/db';
import { reminderLocaleSchema, reminderPreferencesSchema } from '@/server/reminders/preferences';
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
  expectedPriceListVersion: z.number().int().positive(),
  /** Lease-end reminder settings; 30/7/1 days at 09:00 Helsinki time when left out. */
  reminders: reminderPreferencesSchema.optional(),
  /** Language of reminder emails; the signing page's language. */
  locale: reminderLocaleSchema.optional(),
});

export const POST = handleRoute(async (request) => {
  const { reminders, locale, ...input } = await readJsonBody(request, schema);
  const customer = await currentCustomer();
  const [lists, table, vatRates, questionsFile] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
    loadQuestions(),
  ]);
  const contract = await signApplication(
    db,
    input,
    todayIso(),
    {
      lists,
      table,
      vatRates,
      questions: questionsFile.questions,
    },
    customer
      ? {
          recipientId: customer.id,
          locale: locale ?? 'en',
          preferences: reminders ?? defaultReminderPreferences(FALLBACK_TIME_ZONE),
          now: new Date(),
        }
      : undefined
  );
  return ok(contract, { status: 201 });
});
