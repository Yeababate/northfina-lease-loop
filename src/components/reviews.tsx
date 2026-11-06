// Ratings shown to customers: star rows, the "Leased by … ★ 4.5" line on the item page, and
// a card with the average and the reviews (the provider's on the item page, your own as a
// renter on My leases). Server components; "Show all" is a native <details>.
import { averageText, filledStars, MAX_STARS } from '@/domain/rating-display';
import { formatIsoDate } from '@/i18n/format';
import type { Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import type { ProviderReputation, Reputation } from '@/server/reputation';
import { textLink } from './ui';

/** How many reviews show before "Show all". */
export const REVIEWS_SHOWN = 3;

export function Stars({ filled, label }: { filled: number; label: string }) {
  return (
    <span role="img" aria-label={label} className="whitespace-nowrap text-amber-500">
      {'★'.repeat(filled)}
      <span className="text-stone-300 dark:text-stone-600">{'★'.repeat(MAX_STARS - filled)}</span>
    </span>
  );
}

type Common = { locale: Locale; t: Translate };

/** Under the item name: who leases it out, and their average, linking to the reviews card. */
export function ProviderRatingLine({
  provider,
  locale,
  t,
}: Common & { provider: ProviderReputation }) {
  const { count, averageTenths } = provider.summary;
  return (
    <div className="mt-1 text-sm">
      <p className="text-stone-700 dark:text-stone-300">
        {t('reviews.leasedBy', { name: provider.name })}
      </p>
      {averageTenths === null ? (
        <p className="text-stone-600 dark:text-stone-400">{t('reviews.noneYetShort')}</p>
      ) : (
        <a href="#provider-reviews" className={`${textLink} inline-flex items-center gap-1.5`}>
          <Stars
            filled={filledStars(averageTenths)}
            label={t('reviews.average', {
              average: averageText(averageTenths, intlLocale[locale]),
            })}
          />
          <span>
            {averageText(averageTenths, intlLocale[locale])} ·{' '}
            {t(count === 1 ? 'reviews.countOne' : 'reviews.count', { count })}
          </span>
        </a>
      )}
    </div>
  );
}

type ReviewsCardProps = Common & {
  id: string;
  title: string;
  reputation: Reputation;
  /** Shown when there are no ratings yet. */
  emptyText: string;
};

export function ReviewsCard({ id, title, reputation, emptyText, locale, t }: ReviewsCardProps) {
  const { count, averageTenths } = reputation.summary;
  const first = reputation.reviews.slice(0, REVIEWS_SHOWN);
  const rest = reputation.reviews.slice(REVIEWS_SHOWN);
  const headingId = `${id}-title`;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="scroll-mt-6 rounded-xl border border-stone-300 px-5 py-4 text-sm dark:border-stone-700"
    >
      <h2 id={headingId} className="font-semibold">
        {title}
      </h2>
      {averageTenths === null ? (
        <p className="mt-1 text-stone-700 dark:text-stone-300">{emptyText}</p>
      ) : (
        <>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <Stars
              filled={filledStars(averageTenths)}
              label={t('reviews.average', {
                average: averageText(averageTenths, intlLocale[locale]),
              })}
            />
            <span className="font-semibold">
              {t('reviews.summary', {
                average: averageText(averageTenths, intlLocale[locale]),
                count: t(count === 1 ? 'reviews.countOne' : 'reviews.count', { count }),
              })}
            </span>
          </p>
          <ReviewList reviews={first} locale={locale} t={t} />
          {rest.length > 0 ? (
            <details className="mt-2">
              <summary className={`${textLink} cursor-pointer`}>
                {t('reviews.showAll', { count })}
              </summary>
              <ReviewList reviews={rest} locale={locale} t={t} />
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

function ReviewList({ reviews, locale, t }: Common & { reviews: Reputation['reviews'] }) {
  return (
    <ul className="mt-3 space-y-3">
      {reviews.map((review) => (
        <li key={review.id} className="border-t border-stone-200 pt-3 dark:border-stone-800">
          <p className="flex flex-wrap items-center gap-x-2">
            <Stars filled={review.stars} label={t('rating.starsOf', { stars: review.stars })} />
            <span className="font-medium">{review.reviewerName}</span>
            <span className="text-stone-600 dark:text-stone-400">
              · {formatIsoDate(review.createdAt.slice(0, 10), locale)}
              {review.edited ? ` · ${t('reviews.edited')}` : ''}
            </span>
          </p>
          {review.comment ? (
            <p className="mt-1 whitespace-pre-line text-stone-800 dark:text-stone-200">
              {review.comment}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
