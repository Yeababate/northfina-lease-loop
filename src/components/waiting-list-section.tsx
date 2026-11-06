// "Your waiting list" on My leases: the customer's open waiting-list requests, one line each,
// with what they asked for and where the request stands. Moved out of the page as it was, so
// the waiting-list cards can change here without touching the page. Server component.
import type { AssetCategory, AssetCondition } from '@/data/schemas';
import { formatEuro } from '@/domain/money';
import { formatIsoDate } from '@/i18n/format';
import type { Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import type { myWaitingList } from '@/server/waiting-list-requests';

type WaitingListSectionProps = {
  requests: Awaited<ReturnType<typeof myWaitingList>>;
  locale: Locale;
  t: Translate;
};

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
        {requests.map((request) => (
          <li key={request.id} className="flex flex-wrap justify-between gap-x-4">
            <span>
              {t('waitlist.mineRow', {
                kind: t(`categoryOne.${request.category as AssetCategory}`),
                budget: formatEuro(request.maxMonthlyNetRentCents, intlLocale[locale]),
                condition: t(`condition.${request.minCondition as AssetCondition}`),
                months: request.preferredTermMonths,
                date: formatIsoDate(request.neededBy, locale),
              })}
            </span>
            <span className="font-medium">
              {request.status === 'waiting'
                ? t('waitlist.status.waiting')
                : request.status === 'expired'
                  ? t('waitlist.status.expired')
                  : t('waitlist.status.offered')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
