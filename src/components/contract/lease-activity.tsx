// "Activity" on the contract page: the lease's history, newest first, folded away by default
// with the latest event shown as a preview. Each entry is a neutral title ("Lease signed"),
// an optional fact line, and who did it and when, so the grammar works in every language.
import type { ActivityActor, ActivityEvent, ActivityItem } from '@/domain/lease-activity';
import { formatEuro } from '@/domain/money';
import { formatIsoDate } from '@/i18n/format';
import type { MessageKey, Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { textLink } from '../ui';

/** Dates and times are shown in Finnish time, where the leases are signed. */
const TIME_ZONE = 'Europe/Helsinki';

type Common = { locale: Locale; t: Translate };

export function LeaseActivity({ items, locale, t }: Common & { items: ActivityItem[] }) {
  const latest = items[0];
  return (
    <div className="text-sm">
      {latest ? (
        <>
          <p className="text-stone-700 dark:text-stone-300">
            {t('activity.latest')} <span className="font-medium">{title(latest.event, t)}</span>
            {' · '}
            {when(latest.at, locale)}
          </p>
          <details className="mt-3">
            <summary className={`${textLink} cursor-pointer`}>
              {t('activity.show', { count: items.length })}
            </summary>
            <ol className="mt-3 space-y-0">
              {items.map((item, index) => (
                <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {/* The timeline: a dot per event, joined by a line. */}
                  <span aria-hidden="true" className="relative flex w-3 shrink-0 justify-center">
                    <span className="mt-1.5 size-2.5 rounded-full bg-blue-600 dark:bg-blue-400" />
                    {index < items.length - 1 ? (
                      <span className="absolute top-4 bottom-[-0.25rem] w-px bg-stone-300 dark:bg-stone-700" />
                    ) : null}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">{title(item.event, t)}</p>
                    {detail(item.event, locale, t)}
                    <p className="text-stone-600 dark:text-stone-400">
                      {actor(item.actor, t)} ·{' '}
                      <time dateTime={item.at}>{when(item.at, locale)}</time>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        </>
      ) : (
        <p className="text-stone-700 dark:text-stone-300">{t('activity.empty')}</p>
      )}
    </div>
  );
}

const titles: Record<Exclude<ActivityEvent['type'], 'reminders' | 'exit_requested'>, MessageKey> = {
  signed: 'activity.event.signed',
  invoices_issued: 'activity.event.invoices',
  exit_withdrawn: 'activity.event.exitWithdrawn',
  return_received: 'activity.event.returnReceived',
  return_completed: 'activity.event.returnCompleted',
  buyout_paid: 'activity.event.buyoutPaid',
  rated: 'activity.event.rated',
  rating_edited: 'activity.event.ratingEdited',
};

function title(event: ActivityEvent, t: Translate): string {
  if (event.type === 'reminders')
    return t(event.enabled ? 'activity.event.remindersOn' : 'activity.event.remindersOff');
  if (event.type === 'exit_requested')
    return t(event.kind === 'buyout' ? 'activity.event.exitBuyout' : 'activity.event.exitReturn');
  return t(titles[event.type]);
}

function detail(event: ActivityEvent, locale: Locale, t: Translate) {
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  if (event.type === 'signed' && event.termMonths !== null && event.monthlyNetCents !== null) {
    return (
      <p>
        {t('activity.detail.signed', {
          months: event.termMonths,
          amount: euro(event.monthlyNetCents),
        })}
      </p>
    );
  }
  if (
    event.type === 'exit_requested' &&
    event.amountNetCents !== null &&
    event.effectiveEndOn !== null
  ) {
    return (
      <p>
        {t('activity.detail.exit', {
          amount: euro(event.amountNetCents),
          date: formatIsoDate(event.effectiveEndOn, locale),
        })}
      </p>
    );
  }
  return null;
}

function actor(who: ActivityActor, t: Translate): string {
  if (who.kind === 'you') return t('activity.you');
  if (who.kind === 'system') return t('activity.system');
  return who.name;
}

function when(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: TIME_ZONE,
  }).format(new Date(iso));
}
