// One signed lease, as sections on one page: summary, invoices, lease-end reminders, rating
// (once completed) and ending early (last, with a confirm step). Only the contract's renter
// and provider can open it; the actions are the renter's.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { EarlyExit } from '@/components/contract/early-exit';
import { RateLease } from '@/components/contract/rate-lease';
import { ReminderSettings } from '@/components/contract/reminder-settings';
import { InvoicesPanel } from '@/components/contract/invoices-panel';
import { LeaseActivity } from '@/components/contract/lease-activity';
import { DiscountBreakdown } from '@/components/discount-breakdown';
import { Badge, textLink } from '@/components/ui';
import { isoDateSchema } from '@/data/schemas';
import { loadVatRates } from '@/data/load';
import { invoicePrice } from '@/domain/contract-pricing';
import { previousDay } from '@/domain/lease-overview';
import { formatEuro } from '@/domain/money';
import { isCompletedLease, leasePhase } from '@/domain/profile-leases';
import { ratingEligibility } from '@/domain/ratings';
import { formatIsoDate } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import { intlLocale, isLocale } from '@/i18n/locales';
import { ApiError } from '@/server/api-response';
import { getAsset } from '@/server/assets';
import { currentPrincipal } from '@/server/current-principal';
import { db } from '@/server/db';
import { readExitView } from '@/server/exit-requests';
import { getParticipantContract } from '@/server/profile';
import { loadLeaseActivity } from '@/server/lease-activity';
import { ownContractRating } from '@/server/ratings';
import { getReminderSettings } from '@/server/reminders/preferences';
import { todayIso } from '@/server/today';

export default async function ContractPage({
  params,
  searchParams,
}: PageProps<'/[locale]/contracts/[id]'>) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  await connection();
  const principal = await currentPrincipal();
  if (!principal) {
    redirect(`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/contracts/${id}`)}`);
  }
  const contract = await getParticipantContract(db, principal.id, id).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });

  const t = getT(locale);
  const today = todayIso();
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const date = (iso: string) => formatIsoDate(iso, locale);
  const isRenter = contract.renterId === principal.id;
  const status = contract.lifecycle?.status ?? 'active';
  const phase = leasePhase(contract, today);

  const assetIds =
    contract.lines.length > 0 ? contract.lines.map((line) => line.assetId) : [contract.assetId];
  const [assets, document, invoices, vat, exitView, rating, reminders, activity] =
    await Promise.all([
      Promise.all(assetIds.map((assetId) => getAsset(db, assetId))),
      db.contractDocument.findUnique({ where: { contractId: id }, select: { locale: true } }),
      db.invoice.findMany({ where: { contractId: id }, orderBy: { period: 'asc' } }),
      loadVatRates(),
      isRenter ? readExitView(db, id, principal.id, today) : null,
      ownContractRating(db, id, principal.id),
      isRenter
        ? getReminderSettings(db, id, principal.id).catch((error: unknown) => {
            if (error instanceof ApiError && error.status === 404) return null;
            throw error;
          })
        : null,
      loadLeaseActivity(db, id, { id: principal.id, displayName: principal.displayName }),
    ]);
  const name = assets
    .map((asset, index) => (asset ? `${asset.make} ${asset.model}` : assetIds[index]))
    .join(' + ');
  const grossToday = invoicePrice(contract, vat, today);
  const query = await searchParams;
  const vatDate = isoDateSchema.safeParse(query.invoiceDate ?? today);
  const vatCheck = vatDate.success ? invoicePrice(contract, vat, vatDate.data) : null;
  const canRate = ratingEligibility({ ...contract, status }, principal.id).ok;
  const pendingExit = exitView?.request?.status === 'pending';
  const badge =
    phase === 'ended'
      ? ({ tone: 'neutral', text: t('leases.status.ended') } as const)
      : pendingExit
        ? ({ tone: 'orange', text: t('leases.status.ending_early') } as const)
        : phase === 'upcoming'
          ? ({ tone: 'blue', text: t('leases.status.upcoming') } as const)
          : ({ tone: 'green', text: t('leases.status.active') } as const);

  const facts = [
    { label: t('contractPage.reference'), value: contract.id, wide: true },
    { label: t('contractPage.starts'), value: date(contract.startOn) },
    {
      label: phase === 'ended' ? t('leases.ended') : t('leases.ends'),
      value: date(previousDay(contract.lifecycle?.actualEndOn ?? contract.endOn)),
    },
    {
      label: t('leases.monthly'),
      value: grossToday.ok
        ? t('leases.monthlyValue', {
            net: euro(contract.monthlyNetCents),
            gross: euro(grossToday.totalCents),
          })
        : t('leases.netOnly', { net: euro(contract.monthlyNetCents) }),
    },
    {
      label: t('leases.buyout'),
      value: t('leases.netOnly', { net: euro(contract.buyoutNetCents) }),
    },
    { label: t('contractPage.signed'), value: date(contract.signedOn) },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href={`/${locale}/leases`} className={textLink}>
        ← {t('contractPage.back')}
      </Link>

      {/* Two columns on wide screens: the work (invoices, ending early) on the left, the
          lease at a glance (summary, reminders, rating) in a sidebar on the right. On a phone
          the sidebar comes first, so the summary is at the top. */}
      <div className="mt-4 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <aside className="space-y-6 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1">
          <section className="rounded-2xl border border-stone-300 bg-white p-6 dark:border-stone-700 dark:bg-stone-900">
            <p className="text-sm text-stone-600 dark:text-stone-400">{t('contract.title')}</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
              <Badge tone={badge.tone}>{badge.text}</Badge>
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm grid-cols-2">
              {facts.map((fact) => (
                <div key={fact.label} className={fact.wide ? 'col-span-2 min-w-0' : 'min-w-0'}>
                  <dt className="text-stone-600 dark:text-stone-400">{fact.label}</dt>
                  <dd className="font-semibold break-words tabular-nums">{fact.value}</dd>
                </div>
              ))}
            </dl>
            <DiscountBreakdown
              price={{
                ...contract,
                originalMonthlyNetCents:
                  contract.originalMonthlyNetCents ?? contract.monthlyNetCents,
              }}
              locale={locale}
            />
            <p className="mt-4 text-sm text-stone-700 dark:text-stone-300">
              {t('contract.rule')}{' '}
              {contract.priceSource === 'next_life'
                ? t('asset.nextLifePrice')
                : t('asset.priceListVersion', { version: contract.priceListVersion })}
              .
            </p>
            <p className="mt-3 text-sm">
              {document ? (
                <a href={`/documents/contracts/${encodeURIComponent(id)}`} className={textLink}>
                  {t('profile.originalPdf')}
                </a>
              ) : (
                t('profile.documentUnavailable')
              )}
            </p>
          </section>

          {isRenter && phase !== 'ended' ? (
            <Section id="reminders" title={t('reminders.title')} intro={t('reminders.intro')}>
              {reminders ? (
                <ReminderSettings
                  contractId={id}
                  locale={locale}
                  settings={{
                    revision: reminders.revision,
                    preferences: reminders.preferences,
                    schedule: reminders.schedule,
                  }}
                  lastDay={previousDay(contract.lifecycle?.actualEndOn ?? contract.endOn)}
                />
              ) : (
                <p className="text-sm">{t('reminders.none')}</p>
              )}
            </Section>
          ) : null}
        </aside>

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
          <InvoicesPanel
            contractId={id}
            actor={contract.actor}
            invoices={invoices}
            today={today}
            locale={locale}
            t={t}
          >
            <details className="mt-4 text-sm">
              <summary className={`${textLink} cursor-pointer`}>
                {t('contractPage.vatCheck')}
              </summary>
              <p className="mt-2">{t('contract.tax')}</p>
              <form className="mt-2 flex flex-wrap items-end gap-2">
                <label className="flex flex-col">
                  {t('contract.invoiceDate')}
                  <input
                    className="mt-1 rounded-lg border border-stone-400 bg-white px-2 py-1.5 dark:border-stone-600 dark:bg-stone-900"
                    name="invoiceDate"
                    type="date"
                    defaultValue={vatDate.success ? vatDate.data : today}
                    required
                  />
                </label>
                <button className="rounded-lg border border-stone-400 px-3 py-1.5 font-medium dark:border-stone-600">
                  {t('contract.calculate')}
                </button>
              </form>
              <p className="mt-2">
                {vatCheck?.ok
                  ? t('contract.invoice', {
                      rate: vatCheck.vatPercent,
                      tax: euro(vatCheck.vatCents),
                      total: euro(vatCheck.totalCents),
                    })
                  : t('contract.unavailable')}
              </p>
            </details>
          </InvoicesPanel>

          {exitView && phase !== 'ended' ? (
            <Section id="end-early" title={t('exit.title')} intro={t('exit.intro')}>
              <EarlyExit
                contractId={id}
                locale={locale}
                returnQuote={exitView.returnQuote}
                buyoutQuote={exitView.buyoutQuote}
                endOfTermBuyoutCents={contract.buyoutNetCents}
                request={
                  exitView.request
                    ? {
                        id: exitView.request.id,
                        kind: exitView.request.kind === 'buyout' ? 'buyout' : 'return',
                        status: exitView.request.status,
                        effectiveEndOn: exitView.request.effectiveEndOn,
                        revision: exitView.request.revision,
                        amountNetCents: exitView.request.quote.amountNetCents,
                      }
                    : null
                }
              />
            </Section>
          ) : null}

          {canRate || rating ? (
            <Section id="rate" title={t('rating.title')} intro={t('rating.intro')}>
              <RateLease
                contractId={id}
                locale={locale}
                rating={
                  rating
                    ? {
                        id: rating.id,
                        stars: rating.stars,
                        comment: rating.comment,
                        currentRevision: rating.currentRevision,
                      }
                    : null
                }
              />
            </Section>
          ) : isRenter && !isCompletedLease(contract) ? (
            <Section id="rate" title={t('rating.title')}>
              <p className="text-sm">{t('rating.notYet')}</p>
            </Section>
          ) : null}

          <Section id="activity" title={t('activity.title')} intro={t('activity.intro')}>
            <LeaseActivity items={activity} locale={locale} t={t} />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section(props: { id: string; title?: string; intro?: string; children: ReactNode }) {
  const headingId = `${props.id}-title`;
  return (
    <section
      id={props.id}
      aria-labelledby={props.title ? headingId : undefined}
      className="scroll-mt-6 rounded-2xl border border-stone-300 bg-white p-6 dark:border-stone-700 dark:bg-stone-900"
    >
      {props.title ? (
        <h2 id={headingId} className="text-xl font-semibold">
          {props.title}
        </h2>
      ) : null}
      {props.intro ? (
        <p className="mt-1 mb-4 text-sm text-stone-700 dark:text-stone-300">{props.intro}</p>
      ) : null}
      {props.children}
    </section>
  );
}
