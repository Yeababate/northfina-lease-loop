// The catalogue: every asset with today's net list price, filtered and sorted from the URL.
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { AssetCard } from '@/components/asset-card';
import { CatalogueFilters, SortSelect } from '@/components/catalogue-filters';
import { loadCoefficientTable, loadPriceLists } from '@/data/load';
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
import { db } from '@/server/db';
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
    loadPriceLists(),
    loadCoefficientTable(),
  ]);
  const terms = availableTerms(table);
  const query = parseCatalogueQuery(await searchParams, {
    today,
    terms,
    defaultTerm: DEFAULT_TERM_MONTHS,
  });

  const items: CatalogueItem[] = assets.map((asset) => {
    const price = listPriceOn(priceLists, asset.id, today);
    return { asset, listPriceCents: price.ok ? price.priceCents : null };
  });
  const shown = filterCatalogue(items, query);
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
        />
      </aside>

      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{t('catalogue.heading')}</h1>
        <p className="mt-2 text-stone-700 dark:text-stone-300">{t('catalogue.intro')}</p>

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
