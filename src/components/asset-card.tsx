// One catalogue item. A server component: it renders to HTML and ships no JavaScript.
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  catalogueBadge,
  isLeasable,
  unavailableReason,
  type CatalogueItem,
} from '@/domain/catalogue';
import { formatEuro } from '@/domain/money';
import type { BestDeal } from '@/domain/deals';
import { percentText } from '@/domain/deals';
import { averageText } from '@/domain/rating-display';
import type { Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import type { ProviderBadge } from '@/server/reputation';
import { Badge, PhotoPlaceholder, secondaryButton, type BadgeTone } from './ui';

const badgeTone = {
  available: 'green',
  reserved: 'orange',
  being_refurbished: 'orange',
  second_life: 'blue',
} as const satisfies Record<ReturnType<typeof catalogueBadge>, BadgeTone>;

type AssetCardProps = {
  item: CatalogueItem;
  /** Where "View and price" goes, with the customer's lease choices already in the URL. */
  href: string;
  /** Who leases it out and their rating; left out when the item has no owner. */
  provider?: ProviderBadge;
  /** The best long-term discount on this item, if its provider offers one. */
  deal?: BestDeal;
  /** Can the signed-in user lease it straight away (#52)? Rendered by the page. */
  readiness?: ReactNode;
  locale: Locale;
  t: Translate;
};

export function AssetCard({ item, href, provider, deal, readiness, locale, t }: AssetCardProps) {
  const { asset, listPriceCents } = item;
  const headingId = `asset-${asset.id}`;
  const badge = catalogueBadge(asset);
  const facts = [
    t(`categoryOne.${asset.category}`),
    t(`condition.${asset.condition}`),
    asset.previous_lives > 0
      ? t('asset.earlierLeases', { count: asset.previous_lives })
      : String(asset.model_year),
  ];

  return (
    <article
      aria-labelledby={headingId}
      className="flex h-full flex-col rounded-2xl border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900"
    >
      <PhotoPlaceholder label={t(`categoryOne.${asset.category}`)} className="h-26" />

      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-stone-600 dark:text-stone-400">{asset.make}</p>
          <h3 id={headingId} className="text-lg leading-snug font-semibold">
            {asset.model}
          </h3>
        </div>
        <Badge tone={badgeTone[badge]}>{t(`badge.${badge}`)}</Badge>
      </div>
      {provider ? <ProviderLine provider={provider} locale={locale} t={t} /> : null}
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{facts.join(' · ')}</p>
      {readiness ? <div className="mt-2">{readiness}</div> : null}
      {deal && isLeasable(asset) ? (
        <p className="mt-2">
          <Badge tone="green">
            {t('deals.badge', {
              percent: percentText(deal.discountBps, intlLocale[locale]),
              months: deal.fromTermMonths,
            })}
          </Badge>
        </p>
      ) : null}

      <div className="mt-auto pt-4">
        <div className="flex items-baseline justify-between gap-3 border-t border-stone-200 pt-3 dark:border-stone-800">
          <p className="text-sm text-stone-600 dark:text-stone-400">{t('asset.listPriceNet')}</p>
          <p className="text-xl font-semibold tabular-nums">
            {listPriceCents === null
              ? t('asset.noPrice')
              : formatEuro(listPriceCents, intlLocale[locale])}
          </p>
        </div>
        {isLeasable(asset) ? (
          <Link
            href={href}
            aria-label={t('asset.viewAndPriceOf', { name: `${asset.make} ${asset.model}` })}
            className={`${secondaryButton} mt-3 w-full`}
          >
            {t('asset.viewAndPrice')}
          </Link>
        ) : (
          <>
            <p className="mt-3 text-center text-sm text-stone-600 dark:text-stone-400">
              {unavailableReason(asset) === 'being_refurbished'
                ? t('asset.refurbishingNote')
                : t('asset.reservedNote')}
            </p>
            {/* Still worth opening: its next life, and joining the waiting list for one. */}
            <Link
              href={href}
              aria-label={t('asset.unavailableDetailsOf', { name: `${asset.make} ${asset.model}` })}
              className={`${secondaryButton} mt-2 w-full`}
            >
              {t('asset.unavailableDetails')}
            </Link>
          </>
        )}
      </div>
    </article>
  );
}

/** "Pelto Agri Rental Oy · ★ 5.0 (1)": just the name while the provider has no ratings. */
function ProviderLine({
  provider,
  locale,
  t,
}: {
  provider: ProviderBadge;
  locale: Locale;
  t: Translate;
}) {
  const average =
    provider.averageTenths === null
      ? null
      : averageText(provider.averageTenths, intlLocale[locale]);
  return (
    <p className="mt-1 flex min-w-0 items-center gap-1 text-sm text-stone-700 dark:text-stone-300">
      <span className="truncate">{provider.name}</span>
      {average === null ? null : (
        <span
          className="shrink-0"
          aria-label={`${t('reviews.average', { average })}, ${t(
            provider.count === 1 ? 'reviews.countOne' : 'reviews.count',
            { count: provider.count }
          )}`}
        >
          {' · '}
          <span aria-hidden="true" className="text-amber-500">
            ★
          </span>
          <span aria-hidden="true">
            {' '}
            {average} ({provider.count})
          </span>
        </span>
      )}
    </p>
  );
}
