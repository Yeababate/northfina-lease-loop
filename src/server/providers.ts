// Demo providers (dealers) and current inventory ownership.
//
// Selecting a provider is a deliberate mock context switch stored in a cookie, the same
// replaceable-adapter idea as currentCustomer(): it is not authentication. Services take a
// stable provider id; a real login can supply it later without changing them.
import type { Asset } from '@/data/schemas';
import { assetCategorySchema } from '@/data/schemas';
import { ApiError } from './api-response';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';

export const PROVIDER_COOKIE = 'lease-loop-provider';

export type DemoProvider = { id: string; displayName: string };

/** Canonical runtime list. Seed defaults are never a provider directory. */
export async function listProviders(db: Pick<PrismaClient, 'provider'>) {
  return db.provider.findMany({
    select: { id: true, displayName: true },
    orderBy: { id: 'asc' },
  });
}

/** Provider identity is always the persisted id, never a display-name match. */
export async function getProvider(db: Pick<PrismaClient, 'provider'>, id: string) {
  return db.provider.findUnique({ where: { id } });
}

/**
 * Two dealers with distinct stock, plus Aino, the default demo customer, who also lends her
 * own like-new e-bike: one person can rent in and rent out on different contracts.
 */
export const DEMO_PROVIDERS: readonly DemoProvider[] = [
  { id: 'provider-kettu', displayName: 'Kettu Mobility Oy' },
  { id: 'provider-pelto', displayName: 'Pelto Agri Rental Oy' },
  { id: 'cust-aino', displayName: 'Aino Virtanen' },
];

/** Who owns an item in the seed: farm machines → Pelto, ebike-005 → Aino, the rest → Kettu. */
export function seedOwnerOf(asset: Pick<Asset, 'id' | 'category'>): string {
  if (asset.id === 'ebike-005') return 'cust-aino';
  return asset.category === 'farm_machine' ? 'provider-pelto' : 'provider-kettu';
}

/** Reads the selected provider id from a Cookie header. Malformed input means none. */
export function providerIdFromCookie(header: string | null): string | null {
  const part = header
    ?.split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${PROVIDER_COOKIE}=`));
  if (!part) return null;
  try {
    const id = decodeURIComponent(part.slice(PROVIDER_COOKIE.length + 1));
    return id.length > 0 && id.length <= 120 ? id : null;
  } catch {
    return null;
  }
}

export async function providerFromRequest(db: PrismaClient, request: Request) {
  const id = providerIdFromCookie(request.headers.get('cookie'));
  return id ? getProvider(db, id) : null;
}

/** The selected provider, or 401 so the client can ask the user to pick one. */
export async function requireProvider(db: PrismaClient, request: Request) {
  const provider = await providerFromRequest(db, request);
  if (!provider) throw new ApiError(401, 'PROVIDER_REQUIRED', 'Select a demo provider first');
  return provider;
}

/**
 * Adds missing demo providers, ownership rows and an imported intake for every demo item
 * currently marked returned in persisted inventory. Imports have no contract or receipt date: their history is
 * unknown and is not invented. Safe to run again; never overwrites existing rows.
 */
export async function seedDealerSide(db: PrismaClient, assets: readonly Asset[]) {
  const [providers, owned, intakes, inventory] = await Promise.all([
    db.provider.findMany({ select: { id: true } }),
    db.assetOwnership.findMany({ select: { assetId: true, providerId: true } }),
    db.returnIntake.findMany({ select: { assetId: true } }),
    db.asset.findMany({
      where: { id: { in: assets.map((asset) => asset.id) } },
      select: { id: true, category: true, status: true },
    }),
  ]);
  const has = (rows: { id?: string; assetId?: string }[], key: string) =>
    rows.some((row) => (row.id ?? row.assetId) === key);
  const newProviders = DEMO_PROVIDERS.filter((p) => !has(providers, p.id));
  const defaultOwner = (asset: { id: string; category: string }) =>
    seedOwnerOf({ id: asset.id, category: assetCategorySchema.parse(asset.category) });
  const newOwnership = inventory
    .filter((a) => !has(owned, a.id))
    .map((a) => ({ assetId: a.id, providerId: defaultOwner(a), source: 'seed' }));
  const newIntakes = inventory
    .filter((a) => a.status === 'returned' && !has(intakes, a.id))
    .map((a) => ({
      id: `seed-${a.id}`,
      assetId: a.id,
      contractId: null,
      providerId: owned.find((row) => row.assetId === a.id)?.providerId ?? defaultOwner(a),
      source: 'seed_import',
    }));
  const created = {
    providers: newProviders.length,
    ownership: newOwnership.length,
    intakes: newIntakes.length,
  };
  if (created.providers + created.ownership + created.intakes === 0) return created;
  await withAudit(
    db,
    {
      actor: 'seed',
      action: 'dealer.seeded',
      entityType: 'dealer',
      entityId: 'demo',
      details: created,
    },
    async (tx) => {
      if (newProviders.length > 0) await tx.provider.createMany({ data: [...newProviders] });
      if (newOwnership.length > 0) await tx.assetOwnership.createMany({ data: newOwnership });
      if (newIntakes.length > 0) await tx.returnIntake.createMany({ data: newIntakes });
    }
  );
  return created;
}
