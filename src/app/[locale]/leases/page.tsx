// My leases (wireframe 6): everything the signed-in customer is leasing, past leases, and
// the combined CO2 estimate. The proxy sends visitors without a name to sign in first.
// Layout: from lg, the lease cards on the left and a sidebar on the right with the CO2 impact
// first, then "Your ratings". Smaller screens stack the same DOM order: CO2 impact, lease cards,
// ratings, so the total is visible without scrolling past the cards.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { LeasesImpactPanel } from '@/components/impact-panel';
import { LeaseCard } from '@/components/lease-card';
import { ReviewsCard } from '@/components/reviews';
import { primaryButton } from '@/components/ui';
import { WaitingListSection } from '@/components/waiting-list-section';
import { loadVatRates } from '@/data/load';
import { getT } from '@/i18n/get-t';
import { isLocale } from '@/i18n/locales';
import { currentPrincipal } from '@/server/current-principal';
import { db } from '@/server/db';
import { loadImpactInputs } from '@/server/impact';
import { myLeaseRatingPrompts } from '@/server/my-lease-ratings';
import { loadMyLeases } from '@/server/my-leases';
import { renterReputation } from '@/server/reputation';
import { myWaitingList } from '@/server/waiting-list-requests';
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
  const [myRatings, myRequests, ratingPrompts] = await Promise.all([
    renterReputation(db, principal.id),
    myWaitingList(db, principal.id),
    myLeaseRatingPrompts(db, principal.id),
  ]);
  const card = (lease: (typeof current)[number], headingLevel: 2 | 3) => (
    <LeaseCard
      key={lease.id}
      lease={lease}
      headingLevel={headingLevel}
      rating={ratingPrompts.get(lease.id)}
      locale={locale}
      t={t}
    />
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t('leases.title')}</h1>
        <p className="mt-1 text-stone-700 dark:text-stone-300">{t('leases.intro')}</p>
      </header>

      {/* One grid, three items in reading order. From lg the leases span both rows of the left
          column; the second row takes the leftover height, so "Your ratings" sits right under
          the CO2 impact however long the list of leases is. */}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr] lg:gap-6">
        {impact ? (
          <div className="lg:col-start-2 lg:row-start-1">
            <LeasesImpactPanel combined={impact} locale={locale} t={t} />
          </div>
        ) : null}

        <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {current.map((lease) => card(lease, 2))}

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

          {past.length > 0 ? (
            <section aria-labelledby="past-leases" className="space-y-4 pt-4">
              <h2 id="past-leases" className="text-xl font-semibold">
                {t('leases.past')}
              </h2>
              {past.map((lease) => card(lease, 3))}
            </section>
          ) : null}

          <WaitingListSection requests={myRequests} locale={locale} t={t} />
        </div>

        <div className={`lg:col-start-2 ${impact ? 'lg:row-start-2' : 'lg:row-start-1'}`}>
          <ReviewsCard
            id="my-ratings"
            title={t('reviews.mine')}
            reputation={myRatings}
            emptyText={t('reviews.mineNone')}
            locale={locale}
            t={t}
          />
        </div>
      </div>
    </div>
  );
}
