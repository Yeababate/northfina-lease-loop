// Find a dealer near you (issue #73). The dealer locations and the home-town table are a
// static data file (data/dealer-locations.json) with coarse positions only. The demo profile
// has no home town (DemoUser holds just a name), so the customer picks one on the page; the
// choice stays in the browser and is never saved.
import { notFound } from 'next/navigation';
import { DealerMap } from '@/components/dealer-map';
import { loadDealerLocations } from '@/data/load';
import { getT } from '@/i18n/get-t';
import { isLocale } from '@/i18n/locales';

export default async function DealersPage({ params }: PageProps<'/[locale]/dealers'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const t = getT(locale);
  const { dealers, cities } = await loadDealerLocations();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t('dealers.title')}</h1>
        <p className="mt-2 text-stone-700 dark:text-stone-300">{t('dealers.intro')}</p>
      </header>

      <DealerMap locale={locale} dealers={dealers} cities={cities} />

      <details className="rounded-xl bg-stone-50 px-5 py-4 text-sm dark:bg-stone-900">
        <summary className="cursor-pointer font-semibold">{t('dealers.howTitle')}</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{t('dealers.how.straight')}</li>
          <li>{t('dealers.how.rounded')}</li>
          <li>{t('dealers.how.private')}</li>
        </ul>
      </details>
    </div>
  );
}
