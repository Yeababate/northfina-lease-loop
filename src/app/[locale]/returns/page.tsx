// The provider's returns console (cards 9 and 10): returned stock on the left, one item's next
// life on the right. received → inspect → record the required work → relist, plus the
// waiting-list matches once the item is inspected. Every number and blocker comes from the
// server (deriveNextLife, getWaitingListMatches); the page only shows them and calls the APIs.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { ProviderPicker } from '@/components/returns/provider-picker';
import { ReturnDetail } from '@/components/returns/return-detail';
import { Badge, textLink } from '@/components/ui';
import { getT, type MessageKey } from '@/i18n/get-t';
import { isLocale } from '@/i18n/locales';
import { ApiError } from '@/server/api-response';
import { db } from '@/server/db';
import { finalizeDueReturns } from '@/server/next-life-commands';
import { getReturn, listReturns } from '@/server/next-life-reads';
import { listProviders, PROVIDER_COOKIE } from '@/server/providers';
import { todayIso } from '@/server/today';
import { getWaitingListMatches } from '@/server/waiting-list';

export default async function ReturnsPage({
  params,
  searchParams,
}: PageProps<'/[locale]/returns'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await connection();
  const t = getT(locale);
  const today = todayIso();
  const providers = await listProviders(db);
  const selectedId = (await cookies()).get(PROVIDER_COOKIE)?.value;
  const provider = providers.find((p) => p.id === selectedId) ?? null;
  const query = await searchParams;
  const wanted = typeof query.intake === 'string' ? query.intake : undefined;

  // The same order as GET /api/returns: finalize due leases first so holds reflect today.
  if (provider) await finalizeDueReturns(db, today);
  const returns = provider ? await listReturns(db, provider.id) : [];
  const intakeId = wanted ?? returns[0]?.id;
  const detail =
    provider && intakeId ? await orNull(getReturn(db, provider.id, intakeId), [404]) : null;
  const matches =
    provider && detail && detail.current && detail.stage !== 'relisted'
      ? await orNull(getWaitingListMatches(db, provider.id, detail.id, today), [409, 422])
      : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('returns.title')}</h1>
      <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">{t('returns.intro')}</p>
      <div className="mt-4">
        <ProviderPicker locale={locale} providers={providers} selectedId={provider?.id ?? ''} />
      </div>

      {!provider ? (
        <p className="mt-6 text-sm">{t('returns.chooseProvider')}</p>
      ) : (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <nav aria-label={t('returns.listLabel')}>
            {returns.length === 0 ? (
              <p className="text-sm">{t('returns.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {returns.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/${locale}/returns?intake=${encodeURIComponent(row.id)}`}
                      aria-current={row.id === detail?.id ? 'page' : undefined}
                      className={
                        'block rounded-xl border p-3 text-sm ' +
                        (row.id === detail?.id
                          ? 'border-blue-600 bg-blue-50 dark:border-blue-400 dark:bg-blue-950'
                          : 'border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-900')
                      }
                    >
                      <span className="block font-semibold">
                        {row.asset.make} {row.asset.model}
                      </span>
                      <span className="block text-stone-600 dark:text-stone-400">
                        {row.asset.id}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={row.canRelist ? 'green' : 'orange'}>
                          {t(`returns.stage.${row.stage}` as MessageKey)}
                        </Badge>
                        {row.onHold ? <Badge tone="neutral">{t('returns.onHold')}</Badge> : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </nav>

          <div className="min-w-0">
            {detail ? (
              <ReturnDetail
                key={`${detail.id}:${detail.revision}`}
                locale={locale}
                detail={detail}
                matches={matches}
              />
            ) : intakeId ? (
              <p className="text-sm">{t('returns.notFound')}</p>
            ) : null}
            <p className="mt-6 text-sm">
              <Link href={`/${locale}/audit`} className={textLink}>
                {t('audit.link')}
              </Link>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Expected refusals (missing intake, not matchable yet) become null; anything else throws. */
async function orNull<T>(promise: Promise<T>, statuses: number[]): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiError && statuses.includes(error.status)) return null;
    throw error;
  }
}
