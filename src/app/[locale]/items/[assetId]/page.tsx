// Item and price: one asset, its facts, and the live lease calculator.
// The page loads data and decides "today"; the calculator does the maths with domain functions.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { LeaseCalculator } from '@/components/lease-calculator';
import { InfoBox, PhotoPlaceholder, textLink } from '@/components/ui';
import { loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
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
import { db } from '@/server/db';
import { rulesForAsset } from '@/server/discount-rules';
import { todayIso } from '@/server/today';

export default async function ItemPage({
  params,
  searchParams,
}: PageProps<'/[locale]/items/[assetId]'>) {
  const { locale, assetId } = await params;
  if (!isLocale(locale)) notFound();
  await connection();

  const [asset, priceLists, table, vatRates] = await Promise.all([
    getAsset(db, assetId),
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
  ]);
  if (!asset) notFound();
  const discountRules = await rulesForAsset(db, assetId);
  const ownership = await db.assetOwnership.findUnique({ where: { assetId } });
  const provider = ownership
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

  const summary = (
    <AssetSummary
      asset={asset}
      listPriceCents={price.ok ? price.priceCents : null}
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
          <Unavailable summary={summary} message={unavailableMessage(asset, t)} />
        ) : !price.ok || !vat.ok ? (
          <Unavailable summary={summary} message={t('lease.unavailable')} />
        ) : (
          <LeaseCalculator
            locale={locale}
            table={table}
            discountRules={discountRules}
            providerName={provider?.displayName}
            listPriceCents={price.priceCents}
            vatRatePercent={vat.rate.rate_percent}
            nextVatChange={
              nextVat ? { ratePercent: nextVat.rate_percent, validFrom: nextVat.valid_from } : null
            }
            initialTerm={termMonths}
            startDate={startDate}
            quotedOn={today}
            applyPath={`/${locale}/items/${asset.id}/apply`}
            summary={summary}
          />
        )}
      </div>
    </div>
  );
}

function AssetSummary(props: {
  asset: Asset;
  listPriceCents: number | null;
  locale: Locale;
  t: Translate;
}) {
  const { asset, listPriceCents, locale, t } = props;
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

function Unavailable({ summary, message }: { summary: React.ReactNode; message: string }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
      {summary}
      <div>
        <InfoBox>
          <p role="status">{message}</p>
        </InfoBox>
      </div>
    </div>
  );
}
