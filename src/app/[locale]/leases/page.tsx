// My leases (wireframe 6): everything the signed-in customer is leasing, past leases, and
// the combined CO2 estimate. The proxy sends visitors without a name to sign in first.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { LeasesImpactPanel } from '@/components/impact-panel';
import { LeaseCard } from '@/components/lease-card';
import { ReviewsCard } from '@/components/reviews';
import { primaryButton } from '@/components/ui';
import { loadVatRates } from '@/data/load';
import { getT } from '@/i18n/get-t';
import { isLocale } from '@/i18n/locales';
import { currentPrincipal } from '@/server/current-principal';
import { db } from '@/server/db';
import { loadImpactInputs } from '@/server/impact';
import { loadMyLeases } from '@/server/my-leases';
import { renterReputation } from '@/server/reputation';
import { todayIso } from '@/server/today';

export default async function MyLeasesPage({ params }: PageProps<'/[locale]/leases'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await connection();
  const principal = await currentPrincipal();
  if (!principal) redirect(`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/leases`)}`);

  const t = getT(locale);
  const [vat, impactInputs] = await Promise.all([loadVatRates(), loadImpactInputs()]);
  const { current, past, impact } = await loadMyLeases(
    db,
    principal.id,
    todayIso(),
    vat,
    impactInputs
  );
  const myRatings = await renterReputation(db, principal.id);

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t('leases.title')}</h1>
        <p className="mt-1 text-stone-700 dark:text-stone-300">{t('leases.intro')}</p>
      </header>

      {current.map((lease) => (
        <LeaseCard key={lease.id} lease={lease} headingLevel={2} locale={locale} t={t} />
      ))}

      {current.length === 0 ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-dashed border-stone-400 p-5 sm:flex-row sm:items-center sm:justify-between dark:border-stone-600">
          <div>
            <h2 className="font-semibold">{t('leases.empty.title')}</h2>
            <p className="text-stone-700 dark:text-stone-300">{t('leases.empty.body')}</p>
          </div>
          <Link href={`/${locale}`} className={primaryButton}>
            {t('leases.browse')}
          </Link>
        </section>
      ) : null}

      {impact ? <LeasesImpactPanel combined={impact} locale={locale} t={t} /> : null}

      {past.length > 0 ? (
        <section aria-labelledby="past-leases" className="space-y-4 pt-4">
          <h2 id="past-leases" className="text-xl font-semibold">
            {t('leases.past')}
          </h2>
          {past.map((lease) => (
            <LeaseCard key={lease.id} lease={lease} headingLevel={3} locale={locale} t={t} />
          ))}
        </section>
      ) : null}

      <ReviewsCard
        id="my-ratings"
        title={t('reviews.mine')}
        reputation={myRatings}
        emptyText={t('reviews.mineNone')}
        locale={locale}
        t={t}
      />
    </div>
  );
}
