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

/**
 * The price slider runs from €0 to this amount. Its top end reads "€15,000+" and means
 * "no upper limit", so expensive farm machines stay reachable.
 */
export const PRICE_SLIDER_MAX_EUROS = 15_000;
/** The slider moves in steps of this many euros. */
export const PRICE_SLIDER_STEP_EUROS = 100;

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
    ...normalisePriceRange(wholeEuros(first('min')), wholeEuros(first('max'))),
    sort: (catalogueSorts as readonly string[]).includes(sort)
      ? (sort as CatalogueSort)
      : 'price_asc',
    startDate: isIsoDate(start) && start >= options.today ? start : options.today,
    termMonths: options.terms.includes(term) ? term : options.defaultTerm,
  };
}

/**
 * Turns slider ends into "no limit": €0 is no lower limit and the slider's top end (or
 * more, from a hand-edited URL) is no upper limit. A minimum above the top is read as the
 * top, so the list and the slider always say the same. Swaps a range given the wrong way round.
 */
export function normalisePriceRange(
  minEuros: number | null,
  maxEuros: number | null
): { minPriceEuros: number | null; maxPriceEuros: number | null } {
  let min = minEuros === 0 || minEuros === null ? null : Math.min(minEuros, PRICE_SLIDER_MAX_EUROS);
  let max = maxEuros !== null && maxEuros >= PRICE_SLIDER_MAX_EUROS ? null : maxEuros;
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  return { minPriceEuros: min, maxPriceEuros: max };
}

export type PriceFilterKind = 'any' | 'from' | 'up_to' | 'between';

/** Which sentence describes the price filter: "Any list price", "From €500", ... */
export function priceFilterKind(query: Pick<CatalogueQuery, 'minPriceEuros' | 'maxPriceEuros'>) {
  const { minPriceEuros: min, maxPriceEuros: max } = query;
  const kind: PriceFilterKind =
    min === null ? (max === null ? 'any' : 'up_to') : max === null ? 'from' : 'between';
  return kind;
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

export type CatalogueBadge = 'available' | 'reserved' | 'being_refurbished' | 'second_life';

/**
 * The badge on a card. Reserved and being refurbished come first: they decide whether the
 * customer can act at all. "Second life" marks an available item that had earlier leases.
 */
export function catalogueBadge(asset: Asset): CatalogueBadge {
  if (asset.status === 'reserved') return 'reserved';
  if (asset.status === 'returned') return 'being_refurbished';
  if (asset.previous_lives > 0) return 'second_life';
  return 'available';
}

/**
 * Whether the customer may price and apply for this item. Only `available` items can be
 * signed (src/server/contracts.ts): a returned item must be inspected, refurbished and
 * relisted first (src/server/next-life-commands.ts), which makes it available again.
 */
export function isLeasable(asset: Asset): boolean {
  return asset.status === 'available';
}

/** Why an item cannot be leased right now, for the message the customer sees; null if it can. */
export function unavailableReason(asset: Asset): 'reserved' | 'being_refurbished' | null {
  if (asset.status === 'reserved') return 'reserved';
  if (asset.status === 'returned') return 'being_refurbished';
  return null;
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
