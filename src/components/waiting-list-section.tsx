// "Your waiting list" on My leases: the customer's waiting-list requests, one card each, with
// what they asked for, where the request stands and when they can expect the item. Each card
// is one link to the request's own page (/[locale]/waiting-list/[id]), which also links the
// offered item and answers "Do you still want this?". Server component.
import Link from 'next/link';
import type { AssetCategory, AssetCondition } from '@/data/schemas';
import { formatEuro } from '@/domain/money';
import { formatIsoDate } from '@/i18n/format';
import type { Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import type { MyWaitingListEntry } from '@/server/waiting-list-requests';

type WaitingListSectionProps = {
  requests: MyWaitingListEntry[];
  locale: Locale;
  t: Translate;
};

/** "E-bike · up to 90,00 € a month · Good or better · 24 months · by 30 Nov 2026". */
export function waitingListRow(request: MyWaitingListEntry, locale: Locale, t: Translate) {
  return t('waitlist.mineRow', {
    kind: t(`categoryOne.${request.category as AssetCategory}`),
    budget: formatEuro(request.maxMonthlyNetRentCents, intlLocale[locale]),
    condition: t(`condition.${request.minCondition as AssetCondition}`),
    months: request.preferredTermMonths,
    date: formatIsoDate(request.neededBy, locale),
  });
}

export function waitingListStatus(request: MyWaitingListEntry, t: Translate) {
  return request.status === 'waiting'
    ? t('waitlist.status.waiting')
    : request.status === 'expired'
      ? t('waitlist.status.expired')
      : t('waitlist.status.offered');
}

/** When the item can be expected, or that we will tell them; nothing for a closed request. */
export function expectedLine(request: MyWaitingListEntry, locale: Locale, t: Translate) {
  if (request.expectedFrom)
    return t('waitlist.expectedFrom', { date: formatIsoDate(request.expectedFrom, locale) });
  return request.status === 'waiting' ? t('waitlist.noMatchYet') : null;
}

/** Renders nothing when there are no requests. */
export function WaitingListSection({ requests, locale, t }: WaitingListSectionProps) {
  if (requests.length === 0) return null;
  return (
    <section
      id="waiting-list"
      aria-labelledby="waiting-list-title"
      className="scroll-mt-6 rounded-xl border border-stone-300 px-5 py-4 text-sm dark:border-stone-700"
    >
      <h2 id="waiting-list-title" className="font-semibold">
        {t('waitlist.mine')}
      </h2>
      <ul className="mt-2 space-y-2">
        {requests.map((request) => {
          const expected = expectedLine(request, locale, t);
          return (
            <li key={request.id}>
              {/* The whole card is the link; its text is the accessible name. */}
              <Link
                href={`/${locale}/waiting-list/${encodeURIComponent(request.id)}`}
                className="block rounded-lg border border-stone-200 px-3 py-2 hover:border-blue-500 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-stone-800 dark:hover:bg-stone-900"
              >
                <span className="flex flex-wrap justify-between gap-x-4">
                  <span>{waitingListRow(request, locale, t)}</span>
                  <span className="font-medium">{waitingListStatus(request, t)}</span>
                </span>
                {expected ? (
                  <span className="mt-1 block text-stone-700 dark:text-stone-300">{expected}</span>
                ) : null}
                {request.replyBy ? (
                  <span className="mt-1 block font-medium text-orange-800 dark:text-orange-300">
                    {t('waitlist.cardAsk', { date: formatIsoDate(request.replyBy, locale) })}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
