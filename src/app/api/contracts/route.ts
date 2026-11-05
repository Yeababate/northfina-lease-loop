// POST /api/contracts: sign an approved application. The body carries the lease choice and
// the answers; the server prices the lease and decides the application again before signing.
import { z } from 'zod';
import { loadCoefficientTable, loadPriceLists, loadQuestions, loadVatRates } from '@/data/load';
import { centsSchema, isoDateSchema } from '@/data/schemas';
import { FALLBACK_TIME_ZONE } from '@/domain/local-time';
import { defaultReminderPreferences } from '@/domain/reminder-preferences';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { signApplication } from '@/server/contracts';
import { db } from '@/server/db';
import { readDemoNameFromRequest } from '@/server/demo-session';
import { reminderPreferencesSchema } from '@/server/reminders/preferences';
import { todayIso } from '@/server/today';
import { requirePrincipal } from '@/server/mock-users';

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
  /** Language of the contract PDF and of reminder emails; the signing page's language. */
  locale: z.enum(['en', 'fi', 'sv', 'et']).default('en'),
  /** Lease-end reminder settings (#10); 30/7/1 days at 09:00 Helsinki time when left out. */
  reminders: reminderPreferencesSchema.optional(),
});

export const POST = handleRoute(async (request) => {
  const { reminders, ...input } = await readJsonBody(request, schema);
  const principal = await requirePrincipal(db, request);
  // Reminders belong to the demo sign-in name, as in src/server/reminders/recipient.ts.
  const demoName = readDemoNameFromRequest(request);
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
    principal.id,
    demoName
      ? {
          recipientId: demoName,
          locale: input.locale,
          preferences: reminders ?? defaultReminderPreferences(FALLBACK_TIME_ZONE),
          now: new Date(),
        }
      : undefined
  );
  return ok(contract, { status: 201 });
});
