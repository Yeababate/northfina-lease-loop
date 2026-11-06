// The catalogue: every asset with today's net list price, filtered and sorted from the URL.
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { AssetCard } from '@/components/asset-card';
import { CatalogueFilters, SortSelect } from '@/components/catalogue-filters';
import { loadCoefficientTable } from '@/data/load';
import { assetCategorySchema, assetConditionSchema } from '@/data/schemas';
import {
  catalogueSorts,
  filterCatalogue,
  parseCatalogueQuery,
  type CatalogueItem,
} from '@/domain/catalogue';
import { listPriceOn } from '@/domain/price-list';
import { availableTerms, DEFAULT_TERM_MONTHS } from '@/domain/pricing';
import { getT } from '@/i18n/get-t';
import { isLocale } from '@/i18n/locales';
import { listAssets } from '@/server/assets';
import { providerBadgesForAssets } from '@/server/reputation';
import { dealBadgesForAssets, providerOffer } from '@/server/deals';
import { textLink } from '@/components/ui';
import { db } from '@/server/db';
import { loadPricingLists } from '@/server/price-lists';
import { todayIso } from '@/server/today';

export default async function CataloguePage({ params, searchParams }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Render on every request: prices depend on today's date and on the database.
  await connection();

  const t = getT(locale);
  const today = todayIso(); // the page decides what "today" is; domain code never reads the clock
  const [assets, priceLists, table] = await Promise.all([
    listAssets(db),
    loadPricingLists(db),
    loadCoefficientTable(),
  ]);
  const terms = availableTerms(table);
  const rawQuery = await searchParams;
  const query = parseCatalogueQuery(rawQuery, {
    today,
    terms,
    defaultTerm: DEFAULT_TERM_MONTHS,
  });

  const items: CatalogueItem[] = assets.map((asset) => {
    const price = listPriceOn(priceLists, asset.id, today);
    return { asset, listPriceCents: price.ok ? price.priceCents : null };
  });
  // "See these items" on the Deals page narrows the catalogue to one provider's stock.
  const providerParam = typeof rawQuery.provider === 'string' ? rawQuery.provider : null;
  const offer = providerParam ? await providerOffer(db, providerParam) : null;
  const shown = filterCatalogue(
    offer ? items.filter((item) => offer.assetIds.has(item.asset.id)) : items,
    query
  );
  const shownIds = shown.map((item) => item.asset.id);
  const [providers, deals] = await Promise.all([
    providerBadgesForAssets(db, shownIds),
    dealBadgesForAssets(db, shownIds, terms),
  ]);
  const leaseParams = new URLSearchParams({
    term: String(query.termMonths),
    start: query.startDate,
  }).toString();

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[15rem_1fr]">
      <aside>
        <CatalogueFilters
          locale={locale}
          query={query}
          categories={assetCategorySchema.options}
          conditions={assetConditionSchema.options}
          terms={terms}
          today={today}
          provider={offer ? (providerParam ?? undefined) : undefined}
        />
      </aside>

      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{t('catalogue.heading')}</h1>
        <p className="mt-2 text-stone-700 dark:text-stone-300">{t('catalogue.intro')}</p>
        {offer && providerParam ? (
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-green-50 px-4 py-2.5 text-sm dark:bg-green-950/50">
            <span className="font-medium">{t('deals.showingProvider', { name: offer.name })}</span>
            <a href={`/${locale}`} className={textLink}>
              {t('deals.showAll')}
            </a>
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <p role="status" className="text-stone-700 dark:text-stone-300">
            {t('catalogue.showing', { shown: shown.length, total: items.length })}
          </p>
          <SortSelect
            label={t('catalogue.sortBy')}
            value={query.sort}
            options={catalogueSorts.map((sort) => ({ value: sort, label: t(`sort.${sort}`) }))}
          />
        </div>

        {items.length === 0 ? (
          <EmptyNote text={t('catalogue.empty')} />
        ) : shown.length === 0 ? (
          <EmptyNote text={t('catalogue.noMatches')} />
        ) : (
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((item) => (
              <li key={item.asset.id}>
                <AssetCard
                  item={item}
                  href={`/${locale}/items/${item.asset.id}?${leaseParams}`}
                  provider={providers.get(item.asset.id)}
                  deal={deals.get(item.asset.id)}
                  locale={locale}
                  t={t}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <p className="mt-6 rounded-xl border border-dashed border-stone-400 p-6 text-stone-700 dark:border-stone-600 dark:text-stone-300">
      {text}
    </p>
  );
}
