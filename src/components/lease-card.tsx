// One lease on "My leases" (wireframe 6): photo, name and status, then progress, rent, next
// invoice, end date and buyout, with links to the contract PDF, invoices and early end.
import Link from 'next/link';
import { formatEuro } from '@/domain/money';
import { formatIsoDate } from '@/i18n/format';
import type { Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import type { LeaseCardView } from '@/server/my-leases';
import { Badge, PhotoPlaceholder, textLink, type BadgeTone } from './ui';

type Status = 'active' | 'upcoming' | 'ended' | 'ending_early' | 'awaiting_signature';
const statusTone: Record<Status, BadgeTone> = {
  awaiting_signature: 'orange',
  active: 'green',
  upcoming: 'blue',
  ending_early: 'orange',
  ended: 'neutral',
};

type LeaseCardProps = {
  lease: LeaseCardView;
  /** 2 for current leases right under the page title, 3 under the "Past leases" heading. */
  headingLevel: 2 | 3;
  locale: Locale;
  t: Translate;
};

export function LeaseCard({ lease, headingLevel, locale, t }: LeaseCardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const date = (iso: string) => formatIsoDate(iso, locale);
  const status: Status = lease.awaitingSignatory
    ? 'awaiting_signature'
    : lease.phase === 'ended'
      ? 'ended'
      : lease.endingEarly
        ? 'ending_early'
        : lease.phase;
  const name = lease.items
    .map((item) => (item.make && item.model ? `${item.make} ${item.model}` : item.id))
    .join(' + ');
  const headingId = `lease-${lease.id}`;
  const contractHref = `/${locale}/contracts/${encodeURIComponent(lease.id)}`;

  const facts = [
    {
      label: t('leases.progress'),
      value: lease.awaitingSignatory
        ? t('leases.waitingFor', { email: lease.awaitingSignatory })
        : lease.phase === 'upcoming'
          ? t('leases.startsOn', { date: date(lease.startOn) })
          : t('leases.month', { n: lease.month, total: lease.termMonths }),
    },
    {
      label: t('leases.monthly'),
      value:
        lease.monthlyGrossCents === null
          ? t('leases.netOnly', { net: euro(lease.monthlyNetCents) })
          : t('leases.monthlyValue', {
              net: euro(lease.monthlyNetCents),
              gross: euro(lease.monthlyGrossCents),
            }),
    },
    {
      label: t('leases.nextInvoice'),
      value:
        lease.phase !== 'ended' && lease.nextInvoice
          ? t('leases.nextInvoiceValue', {
              date: date(lease.nextInvoice.invoiceDate),
              amount: euro(lease.nextInvoice.grossCents),
            })
          : t('leases.noInvoice'),
    },
    {
      label: lease.phase === 'ended' ? t('leases.ended') : t('leases.ends'),
      value: date(lease.lastDay),
    },
    { label: t('leases.buyout'), value: t('leases.netOnly', { net: euro(lease.buyoutNetCents) }) },
  ];

  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-5 rounded-2xl border border-stone-300 bg-white p-5 sm:flex-row dark:border-stone-700 dark:bg-stone-900"
    >
      <PhotoPlaceholder label={t('leases.photo')} className="h-32 shrink-0 sm:h-36 sm:w-36" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <Heading id={headingId} className="text-xl font-semibold">
            <Link href={contractHref} className="hover:underline">
              {name}
            </Link>
          </Heading>
          <Badge tone={statusTone[status]}>{t(`leases.status.${status}`)}</Badge>
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-stone-600 dark:text-stone-400">{fact.label}</dt>
              <dd className="font-semibold tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {lease.hasDocument ? (
            <li>
              <a href={`/documents/contracts/${encodeURIComponent(lease.id)}`} className={textLink}>
                {t('leases.contractPdf')}
              </a>
            </li>
          ) : null}
          {lease.awaitingSignatory ? null : (
            <li>
              <Link href={`${contractHref}#invoices`} className={textLink}>
                {t('leases.invoices')}
              </Link>
            </li>
          )}
          {lease.phase === 'active' && !lease.awaitingSignatory ? (
            <li>
              <Link href={`${contractHref}#end-early`} className={textLink}>
                {lease.endingEarly ? t('leases.endingEarlyLink') : t('leases.endEarly')}
              </Link>
            </li>
          ) : null}
          {lease.completed ? (
            <li>
              <Link href={`${contractHref}#rate`} className={textLink}>
                {t('leases.rate')}
              </Link>
            </li>
          ) : null}
        </ul>
      </div>
    </article>
  );
}
