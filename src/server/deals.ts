// Read adapter for customer-facing deals: each provider's current long-term discounts (the
// Deals page), the best deal per catalogue item (card badges), and which items a provider
// offers (the catalogue's "deals from …" view). Read-only. Like rulesForAsset in
// ./discount-rules.ts, only enabled, unarchived rules of a provider that exists count, and
// an item's rules follow its current AssetOwnership.
import type { AssetCategory } from '@/data/schemas';
import { bestDeal, dealTiers, type BestDeal, type DealTier } from '@/domain/deals';
import type { RentalDiscountRule } from '@/domain/discounts';
import type { PrismaClient } from './prisma-client';

export type ProviderDeal = {
  providerId: string;
  name: string;
  tiers: DealTier[];
  /** Items of this provider that can be leased right now. */
  availableCount: number;
  categories: AssetCategory[];
};

async function activeRulesByProvider(db: PrismaClient, providerIds?: readonly string[]) {
  const [providers, rows] = await Promise.all([
    db.provider.findMany({
      where: providerIds ? { id: { in: [...providerIds] } } : undefined,
      select: { id: true, displayName: true },
    }),
    db.discountRule.findMany({
      where: {
        enabled: true,
        archived: false,
        ...(providerIds ? { providerId: { in: [...providerIds] } } : {}),
      },
    }),
  ]);
  const names = new Map(providers.map((provider) => [provider.id, provider.displayName]));
  const rules = new Map<string, RentalDiscountRule[]>();
  for (const row of rows) {
    if (!names.has(row.providerId)) continue; // unresolved providers never offer deals
    const list = rules.get(row.providerId) ?? [];
    list.push({
      id: row.id,
      revision: row.revision,
      name: row.name,
      minTermMonths: row.minTermMonths,
      maxTermMonths: row.maxTermMonths,
      discountBps: row.discountBps,
      enabled: row.enabled,
    });
    rules.set(row.providerId, list);
  }
  return { names, rules };
}

/** Every provider with a current long-term discount, biggest discount first. */
export async function loadDeals(
  db: PrismaClient,
  terms: readonly number[]
): Promise<ProviderDeal[]> {
  const { names, rules } = await activeRulesByProvider(db);
  const deals: ProviderDeal[] = [];
  for (const [providerId, providerRules] of rules) {
    const tiers = dealTiers(providerRules, terms);
    if (tiers.length === 0) continue;
    const owned = await db.assetOwnership.findMany({
      where: { providerId },
      select: { assetId: true },
    });
    const assets = await db.asset.findMany({
      where: { id: { in: owned.map((row) => row.assetId) }, status: 'available' },
      select: { category: true },
    });
    deals.push({
      providerId,
      name: names.get(providerId) ?? providerId,
      tiers,
      availableCount: assets.length,
      categories: [...new Set(assets.map((asset) => asset.category as AssetCategory))].sort(),
    });
  }
  const top = (deal: ProviderDeal) => Math.max(...deal.tiers.map((tier) => tier.discountBps));
  return deals.sort((a, b) => top(b) - top(a) || a.name.localeCompare(b.name));
}

/** The best deal for each of these items, for the catalogue badge. Items without one are left out. */
export async function dealBadgesForAssets(
  db: PrismaClient,
  assetIds: readonly string[],
  terms: readonly number[]
): Promise<Map<string, BestDeal>> {
  const ownership = await db.assetOwnership.findMany({
    where: { assetId: { in: [...assetIds] } },
    select: { assetId: true, providerId: true },
  });
  const { rules } = await activeRulesByProvider(db, [
    ...new Set(ownership.map((row) => row.providerId)),
  ]);
  const best = new Map<string, BestDeal | null>();
  const badges = new Map<string, BestDeal>();
  for (const { assetId, providerId } of ownership) {
    if (!best.has(providerId)) best.set(providerId, bestDeal(rules.get(providerId) ?? [], terms));
    const deal = best.get(providerId);
    if (deal) badges.set(assetId, deal);
  }
  return badges;
}

/** A provider's name and the ids of the items it offers, or null for an unknown provider. */
export async function providerOffer(
  db: PrismaClient,
  providerId: string
): Promise<{ name: string; assetIds: Set<string> } | null> {
  const provider = await db.provider.findUnique({
    where: { id: providerId },
    select: { displayName: true },
  });
  if (!provider) return null;
  const owned = await db.assetOwnership.findMany({
    where: { providerId },
    select: { assetId: true },
  });
  return { name: provider.displayName, assetIds: new Set(owned.map((row) => row.assetId)) };
}
