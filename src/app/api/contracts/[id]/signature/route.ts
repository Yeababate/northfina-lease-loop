// POST /api/contracts/:id/signature — the company's named signatory signs a contract that is
// waiting for them (card 6). Sign in with the signatory's email as the demo name first.
import { z } from 'zod';
import { loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
import { centsSchema, isoDateSchema } from '@/data/schemas';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { requirePrincipal } from '@/server/mock-users';
import { signAsSignatory, type SignatoryOfferSnapshot } from '@/server/signatory';
import { todayIso } from '@/server/today';

type Context = { params: Promise<{ id: string }> };

const snapshotSchema = z.strictObject({
  assetId: z.string().min(1),
  termMonths: z.union([z.literal(12), z.literal(24), z.literal(36), z.literal(48)]),
  downPaymentCents: centsSchema,
  startOn: isoDateSchema,
  monthlyNetCents: centsSchema,
  originalMonthlyNetCents: centsSchema,
  monthlyDiscountCents: centsSchema,
  discountBps: z.number().int().min(0),
  buyoutNetCents: centsSchema,
  monthlyGrossCents: centsSchema,
  vatPercent: z.number().nonnegative(),
  priceListVersion: z.number().int().positive(),
  priceSource: z.enum(['price_list', 'next_life']),
  listPriceCents: centsSchema,
  discountRuleId: z.string().min(1).nullable(),
  discountRuleRevision: z.number().int().positive().nullable(),
  coefficientVersion: z.number().int().positive(),
  coefficientId: z.string().min(1),
  band: z.string().min(1),
  factor: z.number().positive(),
  financedCents: centsSchema,
});

export const POST = handleRoute(async (request, { params }: Context) => {
  const [{ id }, principal] = await Promise.all([params, requirePrincipal(db, request)]);
  const { expected } = await readJsonBody(request, z.strictObject({ expected: snapshotSchema }));
  const [lists, table, vatRates] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
  ]);
  return ok(
    await signAsSignatory(
      db,
      principal,
      id,
      todayIso(),
      { lists, table, vatRates },
      expected as SignatoryOfferSnapshot
    )
  );
});
