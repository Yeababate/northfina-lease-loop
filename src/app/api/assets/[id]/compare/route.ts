// GET /api/assets/:id/compare?options=24:0,36:0[&start=2026-11-06]
// Prices 2–4 term:down-payment options (down payment in cents) side by side for one item,
// with today's list price, the owner's long-term discounts and the VAT on each invoice date.
// Options that cannot be leased come back with a reason. Read-only; the maths is
// compareOptions in src/domain/price-breakdown.ts.
import { z } from 'zod';
import { isoDateSchema } from '@/data/schemas';
import { loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
import { listPriceOn } from '@/domain/price-list';
import { compareOptions, MAX_COMPARE_OPTIONS, MIN_COMPARE_OPTIONS } from '@/domain/price-breakdown';
import { fail, handleRoute, ok } from '@/server/api-response';
import { assetPriceOverride } from '@/server/assets';
import { db } from '@/server/db';
import { rulesForAsset } from '@/server/discount-rules';
import { todayIso } from '@/server/today';

const optionSchema = z
  .string()
  .regex(/^\d{1,3}:\d{1,12}$/, 'Use months:downPaymentCents, e.g. 36:0')
  .transform((text) => {
    const [months, down] = text.split(':');
    return { termMonths: Number(months), downPaymentCents: Number(down) };
  });

const querySchema = z.strictObject({
  options: z
    .string()
    .transform((text) => text.split(','))
    .pipe(z.array(optionSchema).min(MIN_COMPARE_OPTIONS).max(MAX_COMPARE_OPTIONS)),
  start: isoDateSchema.optional(),
});

export const GET = handleRoute(
  async (request, { params }: RouteContext<'/api/assets/[id]/compare'>) => {
    const { id } = await params;
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const today = todayIso();
    const startOn = query.start ?? today;
    if (startOn < today) return fail(400, 'START_IN_PAST', 'The lease cannot start in the past');

    const asset = await db.asset.findUnique({ where: { id } });
    if (!asset) return fail(404, 'ASSET_NOT_FOUND', 'Asset not found');
    const [lists, table, vat, discountRules] = await Promise.all([
      loadPriceLists(),
      loadCoefficientTable(),
      loadVatRates(),
      rulesForAsset(db, id),
    ]);
    const price = listPriceOn(lists, id, today, assetPriceOverride(asset));
    if (!price.ok) return fail(409, 'NO_PRICE', 'This item has no price today');

    return ok({
      assetId: id,
      listPriceCents: price.priceCents,
      priceListVersion: price.priceListVersion,
      startOn,
      ...compareOptions(
        { table, discountRules, listPriceCents: price.priceCents, vat, startOn },
        query.options
      ),
    });
  }
);
