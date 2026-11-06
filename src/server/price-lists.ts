// The price lists the app prices with: the data pack's lists plus every relisted item's
// next-life price (src/domain/next-life-prices.ts). Use this instead of loadPriceLists()
// wherever a customer is shown or charged a price, so second-life items cost what they are
// worth now everywhere: catalogue, item page, comparison, application and signing.
import { loadPriceLists } from '@/data/load';
import type { PriceList } from '@/data/schemas';
import { withNextLifePrices } from '@/domain/next-life-prices';
import type { TransactionClient } from './audit';
import type { PrismaClient } from './prisma-client';

export async function loadPricingLists(db: PrismaClient | TransactionClient): Promise<PriceList[]> {
  const [lists, relisted] = await Promise.all([
    loadPriceLists(),
    db.returnIntake.findMany({
      where: { relistedOn: { not: null }, nextLifePriceCents: { not: null } },
      select: { assetId: true, relistedOn: true, nextLifePriceCents: true },
    }),
  ]);
  return withNextLifePrices(
    lists,
    relisted.map((row) => ({
      assetId: row.assetId,
      priceCents: row.nextLifePriceCents!,
      validFrom: row.relistedOn!,
    }))
  );
}

/** The data pack's earliest price for an item: the "list price at its first lease". */
export function firstListPrice(lists: readonly PriceList[], assetId: string): number | null {
  const first = [...lists].sort((a, b) => a.valid_from.localeCompare(b.valid_from))[0];
  return first?.prices[assetId] ?? null;
}
