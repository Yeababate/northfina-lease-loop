// GET /api/assets/:id/related?term=36&budget=12000
// Related items ranked by the adjustable ruleset in data/related-item-rules.json, plus the
// bookable bundles that include this item. `budget` is an optional monthly net maximum in
// cents. Scores, reasons and prices are worked out here; nothing is taken from the caller.
import { z } from 'zod';
import { loadCoefficientTable, loadPriceLists, loadRelatedItemRules } from '@/data/load';
import { availableTerms, DEFAULT_TERM_MONTHS } from '@/domain/pricing';
import { ApiError, fail, handleRoute, ok } from '@/server/api-response';
import { bookableBundlesWithAsset } from '@/server/bundles';
import { db } from '@/server/db';
import { relatedItemsFor } from '@/server/related-items';
import { todayIso } from '@/server/today';

const querySchema = z.strictObject({
  term: z.coerce.number().int().positive().default(DEFAULT_TERM_MONTHS),
  budget: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
});

export const GET = handleRoute(
  async (request, { params }: RouteContext<'/api/assets/[id]/related'>) => {
    const { id } = await params;
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const [lists, table, rules] = await Promise.all([
      loadPriceLists(),
      loadCoefficientTable(),
      loadRelatedItemRules(),
    ]);
    if (!availableTerms(table).includes(query.term))
      throw new ApiError(400, 'UNKNOWN_TERM', 'The term is not offered');

    const result = await relatedItemsFor(
      db,
      {
        assetId: id,
        termMonths: query.term,
        onDate: todayIso(),
        budgetMonthlyNetCents: query.budget ?? null,
      },
      { lists, table, rules }
    );
    if (result.status === 'not_found') return fail(404, 'ASSET_NOT_FOUND', 'Asset not found');

    const bundles = await bookableBundlesWithAsset(db, id);
    return ok({
      assetId: id,
      termMonths: query.term,
      priceBasis: rules.price.basis,
      rulesVersion: rules.version,
      monthlyNetCents: result.status === 'ok' ? result.monthlyNetCents : null,
      items: result.items.map((item) => ({
        assetId: item.asset.id,
        category: item.asset.category,
        make: item.asset.make,
        model: item.asset.model,
        condition: item.asset.condition,
        monthlyNetCents: item.monthlyNetCents,
        score: item.score,
        reasons: item.reasons,
      })),
      bundles: bundles.map(({ id: bundleId, name, description, assetIds, terms, revision }) => ({
        id: bundleId,
        name,
        description,
        assetIds,
        terms,
        revision,
      })),
    });
  }
);
