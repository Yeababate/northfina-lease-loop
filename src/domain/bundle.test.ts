import { describe, expect, it } from 'vitest';
import type { Asset } from '@/data/schemas';
import {
  BUNDLE_MAX_ITEMS,
  bundleAvailability,
  bundleCategories,
  nextBundleRevision,
  validateBundleDraft,
  type BundleDraft,
} from './bundle';

const PROVIDER = 'provider-a';
const ownerOf = new Map([
  ['ebike-1', PROVIDER],
  ['laptop-1', PROVIDER],
  ['laptop-2', PROVIDER],
  ['other-1', 'provider-b'],
]);
const context = { ownerOf, supportedTerms: [12, 24, 36, 48] };
const draft: BundleDraft = {
  providerId: PROVIDER,
  name: '  Commuter kit ',
  description: ' Bike and laptop ',
  assetIds: ['laptop-1', 'ebike-1'],
  terms: [36, 24],
  published: true,
};

function asset(id: string, overrides: Partial<Asset> = {}): Asset {
  return {
    id,
    category: 'e_bike',
    make: 'Make',
    model: id,
    model_year: 2026,
    serial_number: `SN-${id}`,
    condition: 'new',
    usage: { unit: 'km', value: 0 },
    previous_lives: 0,
    status: 'available',
    ...overrides,
  };
}

describe('validateBundleDraft', () => {
  it('normalises a valid draft: trimmed text, provider order kept, terms sorted', () => {
    expect(validateBundleDraft(draft, context)).toEqual({
      ok: true,
      definition: {
        providerId: PROVIDER,
        name: 'Commuter kit',
        description: 'Bike and laptop',
        assetIds: ['laptop-1', 'ebike-1'],
        terms: [24, 36],
        published: true,
      },
    });
  });

  it('needs at least two distinct items and rejects duplicate serialized assets', () => {
    const result = validateBundleDraft({ ...draft, assetIds: ['ebike-1', 'ebike-1'] }, context);
    expect(result).toEqual({
      ok: false,
      problems: [{ code: 'duplicate_asset', assetId: 'ebike-1' }, { code: 'too_few_items' }],
    });
    expect(validateBundleDraft({ ...draft, assetIds: [] }, context)).toEqual({
      ok: false,
      problems: [{ code: 'too_few_items' }],
    });
  });

  it('caps the number of items', () => {
    const many = Array.from({ length: BUNDLE_MAX_ITEMS + 1 }, (_, i) => `x-${i}`);
    const bigOwners = new Map(many.map((id) => [id, PROVIDER]));
    const result = validateBundleDraft(
      { ...draft, assetIds: many },
      { ...context, ownerOf: bigOwners }
    );
    expect(result).toEqual({ ok: false, problems: [{ code: 'too_many_items' }] });
  });

  it("rejects unknown assets and another provider's inventory", () => {
    const result = validateBundleDraft(
      { ...draft, assetIds: ['ebike-1', 'ghost', 'other-1'] },
      context
    );
    expect(result).toEqual({
      ok: false,
      problems: [
        { code: 'unknown_asset', assetId: 'ghost' },
        { code: 'not_owned_by_provider', assetId: 'other-1' },
      ],
    });
  });

  it('checks the name, description and terms', () => {
    const result = validateBundleDraft(
      { ...draft, name: ' ', description: 'x'.repeat(401), terms: [] },
      context
    );
    expect(result).toEqual({
      ok: false,
      problems: [{ code: 'name_required' }, { code: 'description_too_long' }, { code: 'no_terms' }],
    });
    expect(validateBundleDraft({ ...draft, name: 'n'.repeat(81) }, context)).toEqual({
      ok: false,
      problems: [{ code: 'name_too_long' }],
    });
    expect(validateBundleDraft({ ...draft, terms: [24, 24, 18] }, context)).toEqual({
      ok: false,
      problems: [
        { code: 'duplicate_term', term: 24 },
        { code: 'unsupported_term', term: 18 },
      ],
    });
  });
});

describe('bundleAvailability', () => {
  const bundle = { providerId: PROVIDER, assetIds: ['ebike-1', 'laptop-1'], published: true };
  const ok = [
    { asset: asset('ebike-1'), ownerId: PROVIDER },
    { asset: asset('laptop-1', { category: 'laptop' }), ownerId: PROVIDER },
  ];

  it('is bookable when published and every component is available and still owned', () => {
    expect(bundleAvailability(bundle, ok)).toEqual({ bookable: true, reasons: [] });
  });

  it('is blocked as a whole by one reserved or returned component', () => {
    const reserved = [ok[0]!, { ...ok[1]!, asset: asset('laptop-1', { status: 'reserved' }) }];
    expect(bundleAvailability(bundle, reserved)).toEqual({
      bookable: false,
      reasons: [{ code: 'component_not_available', assetId: 'laptop-1', status: 'reserved' }],
    });
    const returned = [{ ...ok[0]!, asset: asset('ebike-1', { status: 'returned' }) }, ok[1]!];
    expect(bundleAvailability(bundle, returned).reasons).toEqual([
      { code: 'component_not_available', assetId: 'ebike-1', status: 'returned' },
    ]);
  });

  it('reports unpublished, missing and re-owned components', () => {
    const result = bundleAvailability({ ...bundle, published: false }, [
      { asset: asset('ebike-1'), ownerId: 'provider-b' },
    ]);
    expect(result).toEqual({
      bookable: false,
      reasons: [
        { code: 'not_published' },
        { code: 'component_owner_changed', assetId: 'ebike-1' },
        { code: 'component_missing', assetId: 'laptop-1' },
      ],
    });
  });
});

describe('nextBundleRevision', () => {
  it('increments the revision only when the editor saw the current one', () => {
    expect(nextBundleRevision(1, 1)).toEqual({ ok: true, revision: 2 });
    expect(nextBundleRevision(3, 2)).toEqual({ ok: false, reason: 'revision_conflict' });
    expect(() => nextBundleRevision(0, 0)).toThrow(RangeError);
  });
});

describe('bundleCategories', () => {
  it('lists every category once, sorted, so no targeted question is missed', () => {
    expect(
      bundleCategories([{ category: 'laptop' }, { category: 'e_bike' }, { category: 'laptop' }])
    ).toEqual(['e_bike', 'laptop']);
    expect(bundleCategories([])).toEqual([]);
  });
});
