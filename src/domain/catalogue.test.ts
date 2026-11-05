import { beforeAll, describe, expect, it } from 'vitest';
import { loadAssets, loadPriceLists } from '@/data/load';
import type { Asset } from '@/data/schemas';
import {
  catalogueBadge,
  filterCatalogue,
  isIsoDate,
  isLeasable,
  parseCatalogueQuery,
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
  });

  it('finds the reserved item in the data pack', () => {
    expect(items.filter((item) => !isLeasable(item.asset)).map((i) => i.asset.id)).toEqual([
      'ebike-009',
    ]);
  });
});

describe('isIsoDate', () => {
  it('accepts real dates, including 29 Feb in a leap year', () => {
    expect(isIsoDate('2026-11-05')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
  });

  it('rejects impossible dates and other formats', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('5.11.2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});
