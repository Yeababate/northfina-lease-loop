// Loads the data the related-item ruleset needs and runs it. The ranking itself is the
// pure rankRelatedItems in src/domain/related-items.ts; nothing is scored here.
import type { CoefficientTable, PriceList, RelatedItemRules } from '@/data/schemas';
import { monthlyRentBasis, rankRelatedItems, type RelatedItem } from '@/domain/related-items';
import { assetPriceOverride, toAsset } from './assets';
import type { PrismaClient } from './prisma-client';

export type RelatedItemsQuery = {
  assetId: string;
  termMonths: number;
  /** The day prices are read for, normally today. */
  onDate: string;
  budgetMonthlyNetCents?: number | null;
};

export type RelatedItemsData = {
  lists: readonly PriceList[];
  table: CoefficientTable;
  rules: RelatedItemRules;
};

export type RelatedItemsResult =
  | { status: 'not_found' }
  /** The viewed item has no price on this basis, so similarity cannot be measured. */
  | { status: 'cannot_be_priced'; items: [] }
  | { status: 'ok'; monthlyNetCents: number; items: RelatedItem[] };

export async function relatedItemsFor(
  db: PrismaClient,
  query: RelatedItemsQuery,
  data: RelatedItemsData
): Promise<RelatedItemsResult> {
  const viewedRow = await db.asset.findUnique({ where: { id: query.assetId } });
  if (!viewedRow) return { status: 'not_found' };
  const viewed = toAsset(viewedRow);
  const basis = (row: typeof viewedRow) =>
    monthlyRentBasis(
      data.lists,
      data.table,
      row.id,
      query.termMonths,
      query.onDate,
      assetPriceOverride(row)
    );
  const monthlyNetCents = basis(viewedRow);
  if (monthlyNetCents === null) return { status: 'cannot_be_priced', items: [] };

  // Every asset is a candidate; the ruleset's hard checks drop what cannot be offered.
  const candidates = (await db.asset.findMany()).map((row) => ({
    asset: toAsset(row),
    monthlyNetCents: row.status === 'available' ? basis(row) : null,
  }));
  const ranked = rankRelatedItems(
    { asset: viewed, monthlyNetCents, budgetMonthlyNetCents: query.budgetMonthlyNetCents },
    candidates,
    data.rules
  );
  return { status: 'ok', monthlyNetCents, items: ranked.items };
}
