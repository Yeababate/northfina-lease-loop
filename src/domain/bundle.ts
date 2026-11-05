// Bundles: a provider's grouping of physical items that are meant to be leased together.
//
// A bundle definition says WHICH assets belong together, for which terms, and whether the
// offer is published. It deliberately carries no prices: pricing a combined lease is not
// part of this module. Editing a definition never reserves inventory; whether a bundle can
// be offered is worked out from the current state of every component (bundleAvailability).
import type { Asset } from '@/data/schemas';

export const BUNDLE_NAME_MAX = 80;
export const BUNDLE_DESCRIPTION_MAX = 400;
/** At least two distinct physical items, or it is just an individual rental. */
export const BUNDLE_MIN_ITEMS = 2;
/** Keeps a bundle reviewable on one screen. */
export const BUNDLE_MAX_ITEMS = 10;

export type BundleDraft = {
  providerId: string;
  name: string;
  description: string;
  assetIds: readonly string[];
  terms: readonly number[];
  published: boolean;
};

export type BundleDefinition = BundleDraft & {
  assetIds: string[];
  terms: number[];
};

export type BundleProblem =
  | { code: 'name_required' | 'name_too_long' | 'description_too_long' }
  | { code: 'too_few_items' | 'too_many_items' | 'no_terms' }
  | { code: 'duplicate_asset' | 'unknown_asset' | 'not_owned_by_provider'; assetId: string }
  | { code: 'duplicate_term' | 'unsupported_term'; term: number };

export type BundleValidation =
  { ok: true; definition: BundleDefinition } | { ok: false; problems: BundleProblem[] };

export type ValidationContext = {
  /** Current owner of each known asset id. Unknown ids are missing from the map. */
  ownerOf: ReadonlyMap<string, string>;
  /** Terms the catalogue can lease for, e.g. [12, 24, 36, 48]. */
  supportedTerms: readonly number[];
};

/**
 * Checks a provider's bundle draft. Every problem is reported at once so a form can show
 * them together. On success the definition is normalised: trimmed text, asset ids kept in
 * the provider's order, terms sorted ascending.
 */
export function validateBundleDraft(
  draft: BundleDraft,
  context: ValidationContext
): BundleValidation {
  const problems: BundleProblem[] = [];
  const name = draft.name.trim();
  const description = draft.description.trim();
  if (name === '') problems.push({ code: 'name_required' });
  if (name.length > BUNDLE_NAME_MAX) problems.push({ code: 'name_too_long' });
  if (description.length > BUNDLE_DESCRIPTION_MAX) problems.push({ code: 'description_too_long' });

  const assetIds: string[] = [];
  for (const assetId of draft.assetIds) {
    if (assetIds.includes(assetId)) {
      problems.push({ code: 'duplicate_asset', assetId });
      continue;
    }
    assetIds.push(assetId);
    const owner = context.ownerOf.get(assetId);
    if (owner === undefined) problems.push({ code: 'unknown_asset', assetId });
    else if (owner !== draft.providerId) problems.push({ code: 'not_owned_by_provider', assetId });
  }
  if (assetIds.length < BUNDLE_MIN_ITEMS) problems.push({ code: 'too_few_items' });
  if (assetIds.length > BUNDLE_MAX_ITEMS) problems.push({ code: 'too_many_items' });

  const terms: number[] = [];
  for (const term of draft.terms) {
    if (terms.includes(term)) problems.push({ code: 'duplicate_term', term });
    else if (!context.supportedTerms.includes(term))
      problems.push({ code: 'unsupported_term', term });
    else terms.push(term);
  }
  if (draft.terms.length === 0) problems.push({ code: 'no_terms' });

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    definition: {
      ...draft,
      name,
      description,
      assetIds,
      terms: [...terms].sort((a, b) => a - b),
    },
  };
}

export type AvailabilityReason =
  | { code: 'not_published' }
  | { code: 'component_missing'; assetId: string }
  | { code: 'component_not_available'; assetId: string; status: Asset['status'] }
  | { code: 'component_owner_changed'; assetId: string };

export type BundleAvailability = { bookable: boolean; reasons: AvailabilityReason[] };

/**
 * Whether a stored bundle can be offered to renters right now. Every component must still
 * exist, belong to the bundle's provider and be `available` (a reserved or returned item
 * that is not yet relisted blocks the whole bundle). An unpublished bundle is never
 * bookable. A blocked bundle is hidden from renters and shown with these reasons to its
 * provider; nothing is silently substituted.
 */
export function bundleAvailability(
  bundle: Pick<BundleDefinition, 'providerId' | 'assetIds' | 'published'>,
  components: readonly { asset: Asset; ownerId: string }[]
): BundleAvailability {
  const reasons: AvailabilityReason[] = [];
  if (!bundle.published) reasons.push({ code: 'not_published' });
  const byId = new Map(components.map((component) => [component.asset.id, component]));
  for (const assetId of bundle.assetIds) {
    const component = byId.get(assetId);
    if (!component) {
      reasons.push({ code: 'component_missing', assetId });
    } else if (component.ownerId !== bundle.providerId) {
      reasons.push({ code: 'component_owner_changed', assetId });
    } else if (component.asset.status !== 'available') {
      reasons.push({ code: 'component_not_available', assetId, status: component.asset.status });
    }
  }
  return { bookable: reasons.length === 0, reasons };
}

/**
 * The revision an edit produces, or a conflict when the provider edited a stale copy.
 * Revisions start at 1 and grow by one per saved edit, so a later contract can refer to
 * the exact definition it was based on.
 */
export function nextBundleRevision(
  currentRevision: number,
  expectedRevision: number
): { ok: true; revision: number } | { ok: false; reason: 'revision_conflict' } {
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 1) {
    throw new RangeError('revision must be a positive integer');
  }
  if (expectedRevision !== currentRevision) return { ok: false, reason: 'revision_conflict' };
  return { ok: true, revision: currentRevision + 1 };
}

/** All categories in a bundle, once each, sorted: question targeting must see every one. */
export function bundleCategories(assets: readonly Pick<Asset, 'category'>[]) {
  return [...new Set(assets.map((asset) => asset.category))].sort();
}
