import { beforeAll, describe, expect, it } from 'vitest';
import { loadAssets, loadPriceLists } from '@/data/load';
import type { Asset } from '@/data/schemas';
import {
  catalogueBadge,
  filterCatalogue,
  isLeasable,
  normalisePriceRange,
  parseCatalogueQuery,
  priceFilterKind,
  PRICE_SLIDER_MAX_EUROS,
  type CatalogueItem,
  type CatalogueQuery,
} from './catalogue';
import { listPriceOn } from './price-list';

const TODAY = '2026-11-05';
const options = { today: TODAY, terms: [12, 24, 36, 48], defaultTerm: 36 };

let items: CatalogueItem[];
beforeAll(async () => {
  const [assets, priceLists] = await Promise.all([loadAssets(), loadPriceLists()]);
  items = assets.map((asset) => {
    const price = listPriceOn(priceLists, asset.id, TODAY);
    return { asset, listPriceCents: price.ok ? price.priceCents : null };
  });
});

const query = (overrides: Partial<CatalogueQuery> = {}): CatalogueQuery => ({
  ...parseCatalogueQuery({}, options),
  ...overrides,
});
const ids = (list: CatalogueItem[]) => list.map((item) => item.asset.id);

describe('parseCatalogueQuery', () => {
  it('defaults to everything, cheapest first, starting today for the default term', () => {
    expect(parseCatalogueQuery({}, options)).toEqual({
      search: '',
      categories: [],
      conditions: [],
      minPriceEuros: null,
      maxPriceEuros: null,
      sort: 'price_asc',
      startDate: TODAY,
      termMonths: 36,
    });
  });

  it('reads repeated params and drops unknown or duplicate values', () => {
    const parsed = parseCatalogueQuery(
      {
        q: '  Trail ',
        category: ['e_bike', 'boat', 'e_bike'],
        condition: 'poor',
        min: '100',
        max: '5000',
        sort: 'price_desc',
        start: '2026-12-01',
        term: '48',
      },
      options
    );
    expect(parsed).toEqual({
      search: 'Trail',
      categories: ['e_bike'],
      conditions: ['poor'],
      minPriceEuros: 100,
      maxPriceEuros: 5000,
      sort: 'price_desc',
      startDate: '2026-12-01',
      termMonths: 48,
    });
  });

  it('falls back on bad values instead of failing', () => {
    const parsed = parseCatalogueQuery(
      { min: '-5', max: '12.50', sort: 'cheap', start: '2026-02-30', term: '30' },
      options
    );
    expect(parsed).toMatchObject({
      minPriceEuros: null,
      maxPriceEuros: null,
      sort: 'price_asc',
      startDate: TODAY,
      termMonths: 36,
    });
  });

  it('moves a start date in the past to today, and keeps today itself', () => {
    expect(parseCatalogueQuery({ start: '2026-11-04' }, options).startDate).toBe(TODAY);
    expect(parseCatalogueQuery({ start: TODAY }, options).startDate).toBe(TODAY);
  });

  it('takes the first value when a single-value param is repeated', () => {
    expect(parseCatalogueQuery({ q: ['laptop', 'bike'] }, options).search).toBe('laptop');
  });
});

describe('normalisePriceRange', () => {
  it('reads €0 as no lower limit and the top of the slider as no upper limit', () => {
    expect(normalisePriceRange(0, PRICE_SLIDER_MAX_EUROS)).toEqual({
      minPriceEuros: null,
      maxPriceEuros: null,
    });
  });

  it('keeps a limit just below the top of the slider', () => {
    expect(normalisePriceRange(100, PRICE_SLIDER_MAX_EUROS - 100)).toEqual({
      minPriceEuros: 100,
      maxPriceEuros: 14_900,
    });
  });

  it('treats a hand-edited maximum above the slider as no limit', () => {
    expect(normalisePriceRange(null, 50_000).maxPriceEuros).toBeNull();
  });

  it('reads a minimum above the slider as the top of the slider', () => {
    expect(normalisePriceRange(20_000, null).minPriceEuros).toBe(PRICE_SLIDER_MAX_EUROS);
    expect(normalisePriceRange(PRICE_SLIDER_MAX_EUROS, null).minPriceEuros).toBe(15_000);
  });

  it('swaps a range given the wrong way round, and keeps an equal one', () => {
    expect(normalisePriceRange(4000, 500)).toEqual({ minPriceEuros: 500, maxPriceEuros: 4000 });
    expect(normalisePriceRange(3890, 3890)).toEqual({ minPriceEuros: 3890, maxPriceEuros: 3890 });
  });

  it('is applied when reading the URL', () => {
    expect(parseCatalogueQuery({ min: '0', max: '15000' }, options)).toMatchObject({
      minPriceEuros: null,
      maxPriceEuros: null,
    });
  });
});

describe('priceFilterKind', () => {
  it('names each combination of limits', () => {
    expect(priceFilterKind({ minPriceEuros: null, maxPriceEuros: null })).toBe('any');
    expect(priceFilterKind({ minPriceEuros: 500, maxPriceEuros: null })).toBe('from');
    expect(priceFilterKind({ minPriceEuros: null, maxPriceEuros: 4000 })).toBe('up_to');
    expect(priceFilterKind({ minPriceEuros: 500, maxPriceEuros: 4000 })).toBe('between');
  });
});

describe('filterCatalogue', () => {
  it('returns all 30 items by default, cheapest first', () => {
    const result = filterCatalogue(items, query());
    expect(result).toHaveLength(30);
    const prices = result.map((item) => item.listPriceCents ?? Infinity);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('does not change the list it is given', () => {
    const before = ids(items);
    filterCatalogue(items, query({ sort: 'price_desc' }));
    expect(ids(items)).toEqual(before);
  });

  it('searches make, model and id, word by word, ignoring case', () => {
    expect(ids(filterCatalogue(items, query({ search: 'nordvolt trail' })))).toEqual([
      'ebike-003',
      'ebike-012',
    ]);
    expect(ids(filterCatalogue(items, query({ search: 'FARM-002' })))).toEqual(['farm-002']);
    expect(filterCatalogue(items, query({ search: 'submarine' }))).toEqual([]);
  });

  it('combines category and condition filters with AND, values within one with OR', () => {
    const result = filterCatalogue(
      items,
      query({ categories: ['e_bike', 'laptop'], conditions: ['fair'] })
    );
    expect(ids(result).sort()).toEqual(['ebike-007', 'laptop-007']);
  });

  it('includes both ends of the price range', () => {
    const exact = items.find((item) => item.asset.id === 'ebike-003')!.listPriceCents! / 100;
    const result = filterCatalogue(items, query({ minPriceEuros: exact, maxPriceEuros: exact }));
    expect(ids(result)).toContain('ebike-003');
    expect(result.every((item) => item.listPriceCents === exact * 100)).toBe(true);
  });

  it('sorts by price high to low, and by name', () => {
    const desc = filterCatalogue(items, query({ sort: 'price_desc' }));
    expect(desc[0]!.listPriceCents).toBe(Math.max(...items.map((i) => i.listPriceCents ?? 0)));
    const byName = filterCatalogue(items, query({ sort: 'name' }));
    expect(byName[0]!.asset.make <= byName[1]!.asset.make).toBe(true);
  });

  it('puts unpriced items last and drops them when a price filter is set', () => {
    const unpriced: CatalogueItem = { asset: items[0]!.asset, listPriceCents: null };
    const priced: CatalogueItem = { asset: items[1]!.asset, listPriceCents: 100 };
    expect(filterCatalogue([unpriced, priced], query({ sort: 'price_asc' }))[1]).toBe(unpriced);
    expect(filterCatalogue([unpriced, priced], query({ sort: 'price_desc' }))[1]).toBe(unpriced);
    expect(filterCatalogue([unpriced, priced], query({ minPriceEuros: 0 }))).toEqual([priced]);
    expect(filterCatalogue([unpriced, unpriced], query())).toHaveLength(2);
  });
});

describe('badges and leasability', () => {
  const asset = (overrides: Partial<Asset>): Asset => ({ ...items[0]!.asset, ...overrides });

  it('shows Reserved before Second life, and blocks reserved items', () => {
    const reserved = asset({ status: 'reserved', previous_lives: 2 });
    expect(catalogueBadge(reserved)).toBe('reserved');
    expect(isLeasable(reserved)).toBe(false);
  });

  it('marks items with earlier leases as second life', () => {
    expect(catalogueBadge(asset({ status: 'returned', previous_lives: 2 }))).toBe('second_life');
    expect(catalogueBadge(asset({ status: 'available', previous_lives: 0 }))).toBe('available');
    expect(isLeasable(asset({ status: 'available' }))).toBe(true);
    expect(isLeasable(asset({ status: 'returned' }))).toBe(false);
  });

  it('holds reserved and returned stock until it is actually available', () => {
    expect(items.filter((item) => !isLeasable(item.asset)).map((i) => i.asset.id)).toEqual([
      'ebike-007',
      'ebike-008',
      'ebike-009',
      'ebike-011',
      'laptop-006',
      'laptop-007',
      'farm-005',
    ]);
  });
});
