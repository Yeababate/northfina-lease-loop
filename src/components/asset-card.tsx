// One catalogue item. A server component: it renders to HTML and ships no JavaScript.
import Link from 'next/link';
import { catalogueBadge, isLeasable, type CatalogueItem } from '@/domain/catalogue';
import { formatEuro } from '@/domain/money';
import type { Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { Badge, PhotoPlaceholder, secondaryButton, type BadgeTone } from './ui';

const badgeTone = {
  available: 'green',
  reserved: 'orange',
  second_life: 'blue',
} as const satisfies Record<ReturnType<typeof catalogueBadge>, BadgeTone>;

type AssetCardProps = {
  item: CatalogueItem;
  /** Where "View and price" goes, with the customer's lease choices already in the URL. */
  href: string;
  locale: Locale;
  t: Translate;
};

export function AssetCard({ item, href, locale, t }: AssetCardProps) {
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
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{facts.join(' · ')}</p>

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
          <p className="mt-3 py-2.5 text-center text-sm text-stone-600 dark:text-stone-400">
            {t('asset.reservedNote')}
          </p>
        )}
      </div>
    </article>
  );
}
