// "You might also like" on the item page: a compact list in the left column, under the apply
// button, so it is seen without scrolling. Items are ranked by the ruleset in
// data/related-item-rules.json (src/domain/related-items.ts); each shows its own monthly
// rent for the same term, and the main reason it is suggested. Bookable bundles that include
// this item are listed after them.
import Link from 'next/link';
import type { RelatedItem } from '@/domain/related-items';
import { formatEuro } from '@/domain/money';
import type { Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { PhotoPlaceholder } from './ui';

/** How many related items the list shows. */
export const RELATED_ITEM_LIMIT = 4;

type RelatedItemsProps = {
  items: readonly RelatedItem[];
  bundles: readonly { id: string; name: string; description: string }[];
  termMonths: number;
  locale: Locale;
  t: Translate;
};

export function RelatedItems({ items, bundles, termMonths, locale, t }: RelatedItemsProps) {
  if (items.length === 0 && bundles.length === 0) return null;
  const shown = items.slice(0, RELATED_ITEM_LIMIT);

  return (
    <section aria-labelledby="related-title">
      <h2 id="related-title" className="font-semibold">
        {t('related.title')}
      </h2>
      {shown.length > 0 ? (
        <ul className="mt-2 divide-y divide-stone-200 rounded-xl border border-stone-300 dark:divide-stone-800 dark:border-stone-700">
          {shown.map(({ asset, monthlyNetCents, reasons }) => {
            const reason = reasons[0];
            return (
              <li key={asset.id}>
                <Link
                  href={`/${locale}/items/${encodeURIComponent(asset.id)}?term=${termMonths}`}
                  className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/60"
                >
                  <PhotoPlaceholder
                    label={t(`categoryOne.${asset.category}`)}
                    className="h-12 w-14 shrink-0 text-[10px]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {asset.make} {asset.model}
                    </span>
                    <span className="block font-semibold tabular-nums">
                      {t('related.perMonth', {
                        amount: formatEuro(monthlyNetCents, intlLocale[locale]),
                      })}
                    </span>
                    <span className="block text-xs text-stone-600 dark:text-stone-400">
                      {t('related.basis', { months: termMonths })}
                      {reason ? ` · ${t(`related.reason.${reason}`)}` : ''}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-xl text-stone-400">
                    ›
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      {bundles.length > 0 ? (
        <div className="mt-3 text-sm">
          <h3 className="font-semibold">{t('related.bundles')}</h3>
          <ul className="mt-1 space-y-1">
            {bundles.map((bundle) => (
              <li key={bundle.id}>
                <span className="font-medium">{bundle.name}</span>
                {bundle.description ? (
                  <span className="text-stone-600 dark:text-stone-400">
                    {' '}
                    · {bundle.description}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
