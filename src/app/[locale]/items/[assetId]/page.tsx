// Item and price: one asset, its facts, and the live lease calculator.
// The page loads data and decides "today"; the calculator does the maths with domain functions.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ItemImpactPanel } from '@/components/impact-panel';
import { LeaseCalculator } from '@/components/lease-calculator';
import { RelatedItems } from '@/components/related-items';
import { ProviderRatingLine, ReviewsCard } from '@/components/reviews';
import { InfoBox, PhotoPlaceholder, textLink } from '@/components/ui';
import {
  loadCoefficientTable,
  loadPriceLists,
  loadRelatedItemRules,
  loadVatRates,
} from '@/data/load';
import type { Asset } from '@/data/schemas';
import { isLeasable, parseCatalogueQuery } from '@/domain/catalogue';
import { unavailableMessage } from '@/components/unavailable-message';
import { formatEuro } from '@/domain/money';
import { listPriceOn } from '@/domain/price-list';
import { availableTerms, DEFAULT_TERM_MONTHS } from '@/domain/pricing';
import { nextVatChangeAfter, vatRateOn } from '@/domain/vat';
import { formatNumber } from '@/i18n/format';
import { getT, type Translate } from '@/i18n/get-t';
import { intlLocale, isLocale, type Locale } from '@/i18n/locales';
import { getAsset } from '@/server/assets';
import { bookableBundlesWithAsset } from '@/server/bundles';
import { db } from '@/server/db';
import { rulesForAsset } from '@/server/discount-rules';
import { estimateForAsset, loadImpactInputs } from '@/server/impact';
import { relatedItemsFor } from '@/server/related-items';
import { providerReputationForAsset, type ProviderReputation } from '@/server/reputation';
import { todayIso } from '@/server/today';

export default async function ItemPage({
  params,
  searchParams,
}: PageProps<'/[locale]/items/[assetId]'>) {
  const { locale, assetId } = await params;
  if (!isLocale(locale)) notFound();
  await connection();

  const [asset, priceLists, table, vatRates, relatedRules, impactInputs] = await Promise.all([
    getAsset(db, assetId),
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
    loadRelatedItemRules(),
    loadImpactInputs(),
  ]);
  if (!asset) notFound();
  const discountRules = await rulesForAsset(db, assetId);
  // Main's dealer record for the item (AssetOwnership → Provider), shown by the calculator
  // with its discounts. Named apart from `provider`, the owner's ratings further down.
  const ownership = await db.assetOwnership.findUnique({ where: { assetId } });
  const discountProvider = ownership
    ? await db.provider.findUnique({ where: { id: ownership.providerId } })
    : null;

  const t = getT(locale);
  const today = todayIso();
  // Term and start date travel from the catalogue filters; bad values fall back safely.
  const { termMonths, startDate } = parseCatalogueQuery(await searchParams, {
    today,
    terms: availableTerms(table),
    defaultTerm: DEFAULT_TERM_MONTHS,
  });
  const price = listPriceOn(priceLists, asset.id, today);
  const vat = vatRateOn(vatRates.rates, startDate);
  const nextVat = nextVatChangeAfter(vatRates.rates, startDate);
  const [related, bundles, provider] = await Promise.all([
    relatedItemsFor(
      db,
      { assetId: asset.id, termMonths, onDate: today },
      { lists: priceLists, table, rules: relatedRules }
    ),
    bookableBundlesWithAsset(db, asset.id),
    providerReputationForAsset(db, asset.id),
  ]);
  // The estimate does not depend on the term (see src/domain/co2-impact.ts), so the panel
  // is rendered once here rather than following the term slider.
  // Under the apply button in the left column: the CO2 panel, then related items, so the
  // suggestions are visible without scrolling to the bottom of the page.
  const leftExtras = (
    <div className="space-y-6">
      {provider ? (
        <ReviewsCard
          id="provider-reviews"
          title={t('reviews.aboutProvider', { name: provider.name })}
          reputation={provider}
          emptyText={t('reviews.providerNone')}
          locale={locale}
          t={t}
        />
      ) : null}
      <ItemImpactPanel
        result={impactInputs ? estimateForAsset(asset, termMonths, impactInputs) : null}
        locale={locale}
        t={t}
      />
      <RelatedItems
        items={related.status === 'ok' ? related.items : []}
        bundles={bundles}
        termMonths={termMonths}
        locale={locale}
        t={t}
      />
    </div>
  );

  const summary = (
    <AssetSummary
      asset={asset}
      listPriceCents={price.ok ? price.priceCents : null}
      provider={provider}
      locale={locale}
      t={t}
    />
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href={`/${locale}`} className={textLink}>
        ← {t('item.back')}
      </Link>
      <div className="mt-4">
        {!isLeasable(asset) ? (
          <Unavailable
            summary={summary}
            extras={leftExtras}
            message={unavailableMessage(asset, t)}
          />
        ) : !price.ok || !vat.ok ? (
          <Unavailable summary={summary} extras={leftExtras} message={t('lease.unavailable')} />
        ) : (
          <LeaseCalculator
            locale={locale}
            table={table}
            discountRules={discountRules}
            providerName={discountProvider?.displayName}
            listPriceCents={price.priceCents}
            vatRatePercent={vat.rate.rate_percent}
            vatRates={vatRates}
            nextVatChange={
              nextVat ? { ratePercent: nextVat.rate_percent, validFrom: nextVat.valid_from } : null
            }
            initialTerm={termMonths}
            startDate={startDate}
            quotedOn={today}
            applyPath={`/${locale}/items/${asset.id}/apply`}
            summary={summary}
            afterApply={leftExtras}
          />
        )}
      </div>
    </div>
  );
}

function AssetSummary(props: {
  asset: Asset;
  listPriceCents: number | null;
  provider: ProviderReputation | null;
  locale: Locale;
  t: Translate;
}) {
  const { asset, listPriceCents, provider, locale, t } = props;
  const facts = [
    { label: t('condition.label'), value: t(`condition.${asset.condition}`) },
    { label: t('asset.modelYear'), value: String(asset.model_year) },
    {
      label: t('asset.usage'),
      value: t(`usage.${asset.usage.unit}`, { value: formatNumber(asset.usage.value, locale) }),
    },
    { label: t('asset.previousLives'), value: formatNumber(asset.previous_lives, locale) },
  ];

  return (
    <div>
      <PhotoPlaceholder label={t(`categoryOne.${asset.category}`)} className="h-64" />
      <p className="mt-5 text-sm text-stone-600 dark:text-stone-400">{asset.make}</p>
      <h1 className="text-3xl font-semibold tracking-tight">{asset.model}</h1>
      {provider ? <ProviderRatingLine provider={provider} locale={locale} t={t} /> : null}
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt className="text-stone-600 dark:text-stone-400">{fact.label}</dt>
            <dd className="font-semibold">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex items-baseline justify-between gap-4 border-t border-stone-200 pt-4 dark:border-stone-800">
        <p className="text-stone-700 dark:text-stone-300">{t('item.listPriceToday')}</p>
        <p className="text-2xl font-semibold tabular-nums">
          {listPriceCents === null
            ? t('asset.noPrice')
            : formatEuro(listPriceCents, intlLocale[locale])}
        </p>
      </div>
    </div>
  );
}

function Unavailable(props: {
  summary: React.ReactNode;
  extras: React.ReactNode;
  message: string;
}) {
  const { summary, extras, message } = props;
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
      <div>
        {summary}
        <div className="mt-6">{extras}</div>
      </div>
      <div>
        <InfoBox>
          <p role="status">{message}</p>
        </InfoBox>
      </div>
    </div>
  );
}
