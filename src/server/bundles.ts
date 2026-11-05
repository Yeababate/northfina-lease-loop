// Bundle groupings in the database: provider-owned lists of assets meant to be leased
// together. Rules live in src/domain/bundle.ts; this module loads current asset state,
// calls them and writes through withAudit. No prices are stored or calculated here.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BundleOfferSeed } from '@/data/schemas';
import {
  bundleAvailability,
  nextBundleRevision,
  validateBundleDraft,
  type BundleAvailability,
  type BundleDefinition,
} from '@/domain/bundle';
import { ApiError } from './api-response';
import { toAsset } from './assets';
import { withAudit, type TransactionClient } from './audit';
import type { PrismaClient } from './prisma-client';

/**
 * Main has no asset ownership or provider login yet: all inventory belongs to the one
 * demo provider. Replace `assetOwnerId` when assets get a stored owner; the domain checks
 * already reject bundles that mix providers.
 */
export const DEMO_PROVIDER_ID = 'lease-loop-fleet';
export function assetOwnerId(): string {
  return DEMO_PROVIDER_ID;
}

export type BundleOfferView = {
  id: string;
  providerId: string;
  name: string;
  description: string;
  assetIds: string[];
  terms: number[];
  published: boolean;
  revision: number;
  availability: BundleAvailability;
};

export type BundleInput = {
  name: string;
  description: string;
  assetIds: string[];
  terms: number[];
  published: boolean;
};

type Client = PrismaClient | TransactionClient;
const termsSchema = z.array(z.number().int().positive());
const withItems = { items: { orderBy: { position: 'asc' } } } as const;

async function loadComponents(client: Client, assetIds?: readonly string[]) {
  const rows = await client.asset.findMany(
    assetIds ? { where: { id: { in: [...assetIds] } } } : undefined
  );
  return rows.map((row) => ({ asset: toAsset(row), ownerId: assetOwnerId() }));
}

async function toViews(
  client: Client,
  offers: Awaited<ReturnType<typeof findOffers>>
): Promise<BundleOfferView[]> {
  const ids = [...new Set(offers.flatMap((offer) => offer.items.map((item) => item.assetId)))];
  const components = await loadComponents(client, ids);
  return offers.map((offer) => {
    const assetIds = offer.items.map((item) => item.assetId);
    const definition = { providerId: offer.providerId, assetIds, published: offer.published };
    return {
      id: offer.id,
      providerId: offer.providerId,
      name: offer.name,
      description: offer.description,
      assetIds,
      terms: termsSchema.parse(JSON.parse(offer.terms_json)),
      published: offer.published,
      revision: offer.revision,
      availability: bundleAvailability(definition, components),
    };
  });
}

function findOffers(client: Client, where: { id?: string; providerId?: string } = {}) {
  return client.bundleOffer.findMany({ where, include: withItems, orderBy: { id: 'asc' } });
}

/**
 * `public`: only published bundles whose every component is bookable now, for renters.
 * `provider`: all of that provider's bundles, with the reasons any is blocked.
 */
export async function listBundleOffers(
  db: PrismaClient,
  scope: { kind: 'public' } | { kind: 'provider'; providerId: string }
): Promise<BundleOfferView[]> {
  const offers = await findOffers(
    db,
    scope.kind === 'provider' ? { providerId: scope.providerId } : {}
  );
  const views = await toViews(db, offers);
  return scope.kind === 'public' ? views.filter((view) => view.availability.bookable) : views;
}

/** One bundle. Unpublished or blocked bundles are only visible to their provider. */
export async function getBundleOffer(
  db: PrismaClient,
  id: string,
  viewer: { providerId: string | null }
): Promise<BundleOfferView | null> {
  const [view] = await toViews(db, await findOffers(db, { id }));
  if (!view) return null;
  if (view.availability.bookable || view.providerId === viewer.providerId) return view;
  return null;
}

/** Bookable bundles that include this asset, for the item page next to related items. */
export async function bookableBundlesWithAsset(db: PrismaClient, assetId: string) {
  const offers = await db.bundleOffer.findMany({
    where: { published: true, items: { some: { assetId } } },
    include: withItems,
    orderBy: { id: 'asc' },
  });
  return (await toViews(db, offers)).filter((view) => view.availability.bookable);
}

async function validateInTx(
  tx: TransactionClient,
  providerId: string,
  input: BundleInput,
  supportedTerms: readonly number[]
): Promise<BundleDefinition> {
  const components = await loadComponents(tx, input.assetIds);
  const ownerOf = new Map(components.map((c) => [c.asset.id, c.ownerId]));
  const result = validateBundleDraft({ ...input, providerId }, { ownerOf, supportedTerms });
  if (!result.ok)
    throw new ApiError(422, 'INVALID_BUNDLE', 'The bundle is not valid', result.problems);
  return result.definition;
}

function itemRows(definition: BundleDefinition) {
  return definition.assetIds.map((assetId, position) => ({ assetId, position }));
}

/** Creates a bundle. Ownership and assets are checked inside the same transaction. */
export async function createBundleOffer(
  db: PrismaClient,
  input: BundleInput,
  options: { providerId: string; supportedTerms: readonly number[]; id?: string }
): Promise<BundleOfferView> {
  const id = options.id ?? randomUUID();
  await withAudit(
    db,
    {
      actor: options.providerId,
      action: 'bundle_offer.created',
      entityType: 'bundle_offer',
      entityId: id,
      details: input,
    },
    async (tx) => {
      const definition = await validateInTx(tx, options.providerId, input, options.supportedTerms);
      await tx.bundleOffer.create({
        data: {
          id,
          providerId: options.providerId,
          name: definition.name,
          description: definition.description,
          terms_json: JSON.stringify(definition.terms),
          published: definition.published,
          items: { create: itemRows(definition) },
        },
      });
    }
  );
  const [view] = await toViews(db, await findOffers(db, { id }));
  if (!view) throw new Error('created bundle offer disappeared');
  return view;
}

/**
 * Replaces a bundle's definition. The editor sends the revision they saw; a stale copy is
 * a 409 instead of silently overwriting someone else's edit. Another provider's bundle is
 * reported as not found. Already signed leases are unaffected: no contract refers to this
 * row's mutable fields.
 */
export async function updateBundleOffer(
  db: PrismaClient,
  id: string,
  input: BundleInput & { expectedRevision: number },
  options: { providerId: string; supportedTerms: readonly number[] }
): Promise<BundleOfferView> {
  const { expectedRevision, ...draft } = input;
  await withAudit(
    db,
    {
      actor: options.providerId,
      action: 'bundle_offer.updated',
      entityType: 'bundle_offer',
      entityId: id,
      details: input,
    },
    async (tx) => {
      const existing = await tx.bundleOffer.findUnique({ where: { id } });
      if (!existing || existing.providerId !== options.providerId)
        throw new ApiError(404, 'BUNDLE_NOT_FOUND', 'Bundle not found');
      const next = nextBundleRevision(existing.revision, expectedRevision);
      if (!next.ok)
        throw new ApiError(409, 'BUNDLE_CHANGED', 'The bundle changed. Refresh and edit again');
      const definition = await validateInTx(tx, options.providerId, draft, options.supportedTerms);
      const updated = await tx.bundleOffer.updateMany({
        where: { id, revision: expectedRevision },
        data: {
          name: definition.name,
          description: definition.description,
          terms_json: JSON.stringify(definition.terms),
          published: definition.published,
          revision: next.revision,
        },
      });
      if (updated.count !== 1)
        throw new ApiError(409, 'BUNDLE_CHANGED', 'The bundle changed. Refresh and edit again');
      await tx.bundleOfferItem.deleteMany({ where: { offerId: id } });
      await tx.bundleOfferItem.createMany({
        data: itemRows(definition).map((row) => ({ ...row, offerId: id })),
      });
    }
  );
  const [view] = await toViews(db, await findOffers(db, { id }));
  if (!view) throw new Error('updated bundle offer disappeared');
  return view;
}

/** Adds the example bundles from data/bundle-offers.json that are not in the database yet. */
export async function seedBundleOffers(
  db: PrismaClient,
  seeds: readonly BundleOfferSeed[],
  supportedTerms: readonly number[]
): Promise<{ created: number; skipped: number }> {
  const existing = new Set(
    (await db.bundleOffer.findMany({ select: { id: true } })).map((o) => o.id)
  );
  const missing = seeds.filter((seed) => !existing.has(seed.id));
  for (const seed of missing) {
    await createBundleOffer(
      db,
      {
        name: seed.name,
        description: seed.description,
        assetIds: seed.asset_ids,
        terms: seed.terms,
        published: seed.published,
      },
      { providerId: DEMO_PROVIDER_ID, supportedTerms, id: seed.id }
    );
  }
  return { created: missing.length, skipped: seeds.length - missing.length };
}
