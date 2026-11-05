// Catalogue: which items to show, in what order, and how the filters travel in the URL.
// The page reads the URL, these functions decide; nothing here touches the database.
import {
  assetCategorySchema,
  assetConditionSchema,
  type Asset,
  type AssetCategory,
  type AssetCondition,
} from '@/data/schemas';
import { isIsoDate } from './iso-date';

export type CatalogueItem = {
  asset: Asset;
  /** Today's net list price, or null when no price list covers the item today. */
  listPriceCents: number | null;
};

export const catalogueSorts = ['price_asc', 'price_desc', 'name'] as const;
export type CatalogueSort = (typeof catalogueSorts)[number];

export type CatalogueQuery = {
  search: string;
  categories: AssetCategory[];
  conditions: AssetCondition[];
  /** Whole euros, inclusive. null = no limit. */
  minPriceEuros: number | null;
  maxPriceEuros: number | null;
  sort: CatalogueSort;
  /** The lease the customer has in mind; carried to the item page as the default. */
  startDate: string;
  termMonths: number;
};

export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Reads the catalogue filters from URL search params. Anything missing or invalid falls back
 * to a safe default instead of failing, because a hand-edited URL is not an error worth a page.
 * A start date in the past becomes `today`; an unknown term becomes the default term.
 */
export function parseCatalogueQuery(
  params: SearchParams,
  options: { today: string; terms: readonly number[]; defaultTerm: number }
): CatalogueQuery {
  const first = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
  };
  const all = (key: string) => {
    const value = params[key];
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
  };

  const sort = first('sort');
  const term = Number(first('term'));
  const start = first('start');

  return {
    search: first('q').slice(0, 100),
    categories: unique(all('category').filter(isCategory)),
    conditions: unique(all('condition').filter(isCondition)),
    minPriceEuros: wholeEuros(first('min')),
    maxPriceEuros: wholeEuros(first('max')),
    sort: (catalogueSorts as readonly string[]).includes(sort)
      ? (sort as CatalogueSort)
      : 'price_asc',
    startDate: isIsoDate(start) && start >= options.today ? start : options.today,
    termMonths: options.terms.includes(term) ? term : options.defaultTerm,
  };
}

/** Applies search, category, condition and price filters, then sorts. Never mutates `items`. */
export function filterCatalogue(
  items: readonly CatalogueItem[],
  query: CatalogueQuery
): CatalogueItem[] {
  const needle = normalise(query.search);
  const minCents = query.minPriceEuros === null ? null : query.minPriceEuros * 100;
  const maxCents = query.maxPriceEuros === null ? null : query.maxPriceEuros * 100;

  const matches = items.filter(({ asset, listPriceCents }) => {
    if (needle) {
      const haystack = normalise(`${asset.make} ${asset.model} ${asset.id}`);
      if (!needle.split(' ').every((word) => haystack.includes(word))) return false;
    }
    if (query.categories.length > 0 && !query.categories.includes(asset.category)) return false;
    if (query.conditions.length > 0 && !query.conditions.includes(asset.condition)) return false;
    if (minCents !== null || maxCents !== null) {
      // With a price filter on, an item without a price cannot match it.
      if (listPriceCents === null) return false;
      if (minCents !== null && listPriceCents < minCents) return false;
      if (maxCents !== null && listPriceCents > maxCents) return false;
    }
    return true;
  });

  return matches.sort(comparator(query.sort));
}

export type CatalogueBadge = 'available' | 'reserved' | 'second_life';

/** The badge on a card. Reserved wins: it decides whether the customer can act at all. */
export function catalogueBadge(asset: Asset): CatalogueBadge {
  if (asset.status === 'reserved') return 'reserved';
  if (asset.previous_lives > 0) return 'second_life';
  return 'available';
}

/** Whether the customer may start pricing and applying for this item. */
export function isLeasable(asset: Asset): boolean {
  return asset.status !== 'reserved';
}

function comparator(sort: CatalogueSort) {
  const byName = (a: CatalogueItem, b: CatalogueItem) =>
    `${a.asset.make} ${a.asset.model}`.localeCompare(`${b.asset.make} ${b.asset.model}`) ||
    a.asset.id.localeCompare(b.asset.id);
  if (sort === 'name') return byName;

  const direction = sort === 'price_asc' ? 1 : -1;
  return (a: CatalogueItem, b: CatalogueItem) => {
    // Items without a price always go last, whichever way prices are sorted.
    if (a.listPriceCents === null || b.listPriceCents === null) {
      if (a.listPriceCents === b.listPriceCents) return byName(a, b);
      return a.listPriceCents === null ? 1 : -1;
    }
    return direction * (a.listPriceCents - b.listPriceCents) || byName(a, b);
  };
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function wholeEuros(text: string): number | null {
  if (!/^\d{1,9}$/.test(text)) return null;
  return Number(text);
}

function isCategory(value: string): value is AssetCategory {
  return assetCategorySchema.safeParse(value).success;
}

function isCondition(value: string): value is AssetCondition {
  return assetConditionSchema.safeParse(value).success;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
