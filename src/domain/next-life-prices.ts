// A relisted item's next-life price, layered over the data-pack price lists. From the day it
// is relisted, every list that is valid then or later uses the new price for that item, so
// the catalogue, the item page, the comparison and signing (listPriceOn) all see the same
// number. Earlier lists keep the old price: history is not rewritten.
import type { PriceList } from '@/data/schemas';

export type NextLifePrice = { assetId: string; priceCents: number; validFrom: string };

export function withNextLifePrices(
  lists: readonly PriceList[],
  prices: readonly NextLifePrice[]
): PriceList[] {
  if (prices.length === 0) return [...lists];
  return lists.map((list) => {
    const overrides = prices.filter(
      (price) => list.valid_to === null || list.valid_to >= price.validFrom
    );
    if (overrides.length === 0) return list;
    const next = { ...list.prices };
    // The latest relisting of an item wins.
    for (const price of [...overrides].sort((a, b) => a.validFrom.localeCompare(b.validFrom))) {
      if (!Number.isSafeInteger(price.priceCents) || price.priceCents < 0)
        throw new RangeError('Next-life price must be non-negative whole cents');
      next[price.assetId] = price.priceCents;
    }
    return { ...list, prices: next };
  });
}
