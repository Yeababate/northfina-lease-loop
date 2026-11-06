// Deals: the long-term discounts on offer right now, written for customers. One card per
// provider with its offer, how many items it covers, and a link to those items in the
// catalogue with the discounted term already chosen. Dealers set the rules on /discounts.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { primaryButton, secondaryButton } from '@/components/ui';
import { loadCoefficientTable } from '@/data/load';
import { percentText, type DealTier } from '@/domain/deals';
import { availableTerms } from '@/domain/pricing';
import { getT, type Translate } from '@/i18n/get-t';
import { intlLocale, isLocale, type Locale } from '@/i18n/locales';
import { db } from '@/server/db';
import { loadDeals } from '@/server/deals';

export default async function DealsPage({ params }: PageProps<'/[locale]/deals'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await connection();

  const t = getT(locale);
  const terms = availableTerms(await loadCoefficientTable());
  const deals = await loadDeals(db, terms);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t('deals.title')}</h1>
        <p className="mt-2 text-stone-700 dark:text-stone-300">{t('deals.intro')}</p>
      </header>

      {deals.length === 0 ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-dashed border-stone-400 p-5 sm:flex-row sm:items-center sm:justify-between dark:border-stone-600">
          <div>
            <h2 className="font-semibold">{t('deals.none.title')}</h2>
            <p className="text-stone-700 dark:text-stone-300">{t('deals.none.body')}</p>
          </div>
          <Link href={`/${locale}`} className={primaryButton}>
            {t('leases.browse')}
          </Link>
        </section>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {deals.map((deal) => (
            <li
              key={deal.providerId}
              className="flex flex-col rounded-2xl border border-stone-300 bg-white p-5 dark:border-stone-700 dark:bg-stone-900"
            >
              <h2 className="text-lg font-semibold">{deal.name}</h2>
              <ul className="mt-3 space-y-3">
                {deal.tiers.map((tier) => (
                  <li key={tier.fromTermMonths}>
                    <TierText tier={tier} locale={locale} t={t} />
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
                {t(deal.availableCount === 1 ? 'deals.itemsOne' : 'deals.items', {
                  count: deal.availableCount,
                })}
                {deal.categories.length > 0
                  ? ` · ${deal.categories.map((category) => t(`category.${category}`)).join(', ')}`
                  : ''}
              </p>
              <div className="mt-auto pt-4">
                <Link
                  href={`/${locale}?${new URLSearchParams({
                    provider: deal.providerId,
                    term: String(deal.tiers[0]?.fromTermMonths ?? ''),
                  })}`}
                  aria-label={t('deals.seeItemsOf', { name: deal.name })}
                  className={`${secondaryButton} w-full`}
                >
                  {t('deals.seeItems')}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <details className="rounded-xl bg-stone-50 px-5 py-4 text-sm dark:bg-stone-900">
        <summary className="cursor-pointer font-semibold">{t('deals.howTitle')}</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{t('deals.how.automatic')}</li>
          <li>{t('deals.how.rentOnly')}</li>
          <li>{t('deals.how.noStacking')}</li>
          <li>{t('deals.how.locked')}</li>
        </ul>
      </details>
    </div>
  );
}

function TierText({ tier, locale, t }: { tier: DealTier; locale: Locale; t: Translate }) {
  const percent = percentText(tier.discountBps, intlLocale[locale]);
  return (
    <>
      <p className="text-2xl font-bold text-green-700 dark:text-green-400">
        {t('deals.percentOff', { percent })}
      </p>
      <p className="text-sm text-stone-700 dark:text-stone-300">
        {tier.toTermMonths === null
          ? t('deals.fromTerm', { months: tier.fromTermMonths })
          : t('deals.rangeTerm', { from: tier.fromTermMonths, to: tier.toTermMonths })}
      </p>
    </>
  );
}
