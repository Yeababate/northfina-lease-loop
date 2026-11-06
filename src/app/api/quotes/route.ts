import { z } from 'zod';
import { loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
import { centsSchema, isoDateSchema } from '@/data/schemas';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { createQuote } from '@/server/quotes';
import { requirePrincipal } from '@/server/mock-users';
import { todayIso } from '@/server/today';

const offerSchema = z.strictObject({
  monthlyNetCents: centsSchema,
  originalMonthlyNetCents: centsSchema,
  monthlyDiscountCents: centsSchema,
  discountBps: z.number().int().min(0),
  buyoutNetCents: centsSchema,
  monthlyGrossCents: centsSchema,
  priceListVersion: z.number().int().positive(),
  priceSource: z.enum(['price_list', 'next_life']),
  listPriceCents: centsSchema,
  discountRuleId: z.string().min(1).nullable(),
  discountRuleRevision: z.number().int().positive().nullable(),
  coefficientVersion: z.number().int().positive(),
  coefficientId: z.string().min(1),
  band: z.string().min(1),
  factor: z.number().positive(),
});

const schema = z.strictObject({
  requestKey: z.string().uuid(),
  assetId: z.string().min(1),
  termMonths: z.union([z.literal(12), z.literal(24), z.literal(36), z.literal(48)]),
  downPaymentCents: centsSchema,
  startOn: isoDateSchema,
  quotedOn: isoDateSchema,
  expected: offerSchema,
});

export const POST = handleRoute(async (request) => {
  const input = await readJsonBody(request, schema);
  const principal = await requirePrincipal(db, request);
  const [lists, table, vatRates] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
  ]);
  const result = await createQuote(db, principal.id, input, todayIso(), { lists, table, vatRates });
  return ok(result.quote, { status: result.created ? 201 : 200 });
});
