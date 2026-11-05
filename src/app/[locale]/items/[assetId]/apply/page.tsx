// Application and decision for one item and lease choice. The term, down payment and start
// date come from the item page's URL; the server re-prices them, so a hand-edited URL can
// never get a price the calculator would not give.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ApplicationWizard } from '@/components/application/application-wizard';
import { applicationStorageKey } from '@/components/application/storage-key';
import { InfoBox, textLink } from '@/components/ui';
import { loadCoefficientTable, loadPriceLists, loadQuestions, loadVatRates } from '@/data/load';
import { isLeasable, parseCatalogueQuery } from '@/domain/catalogue';
import { isIsoDate } from '@/domain/iso-date';
import { formatEuro } from '@/domain/money';
import { listPriceOn } from '@/domain/price-list';
import { availableTerms, DEFAULT_TERM_MONTHS, quoteLease } from '@/domain/pricing';
import { vatRateOn } from '@/domain/vat';
import { getT } from '@/i18n/get-t';
import { intlLocale, isLocale } from '@/i18n/locales';
import { getAsset } from '@/server/assets';
import { db } from '@/server/db';
import { todayIso } from '@/server/today';
import { currentPrincipal } from '@/server/current-principal';

export default async function ApplyPage({
  params,
  searchParams,
}: PageProps<'/[locale]/items/[assetId]/apply'>) {
  const { locale, assetId } = await params;
  if (!isLocale(locale)) notFound();
  await connection();

  const [asset, priceLists, table, vatRates, questionsFile] = await Promise.all([
    getAsset(db, assetId),
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
    loadQuestions(),
  ]);
  if (!asset) notFound();

  const t = getT(locale);
  const principal = await currentPrincipal();
  const today = todayIso();
  const query = await searchParams;
  const { termMonths, startDate } = parseCatalogueQuery(query, {
    today,
    terms: availableTerms(table),
    defaultTerm: DEFAULT_TERM_MONTHS,
  });
  // The day the customer saw the price, for "Why this price?" when signing. Never after today.
  const quotedText = typeof query.quoted === 'string' ? query.quoted : '';
  const quotedOn = isIsoDate(quotedText) && quotedText <= today ? quotedText : today;
  const downText = typeof query.down === 'string' ? query.down : '0';
  const downPaymentCents = /^\d{1,12}$/.test(downText) ? Number(downText) : -1;

  const price = listPriceOn(priceLists, asset.id, today);
  const vat = vatRateOn(vatRates.rates, startDate);
  const quote =
    price.ok && vat.ok && isLeasable(asset)
      ? quoteLease(table, {
          listPriceCents: price.priceCents,
          downPaymentCents,
          termMonths,
          vatRatePercent: vat.rate.rate_percent,
        })
      : null;

  const leaseParams = new URLSearchParams({
    term: String(termMonths),
    down: String(downPaymentCents),
    start: startDate,
  }).toString();
  const itemHref = `/${locale}/items/${asset.id}?${new URLSearchParams({ term: String(termMonths), start: startDate })}`;
  const name = `${asset.make} ${asset.model}`;
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href={itemHref} className={textLink}>
        ← {t('apply.back', { name })}
      </Link>

      {quote?.ok ? (
        <>
          <p className="mt-2 mb-6 text-sm text-stone-600 dark:text-stone-400">
            {t('apply.deal', {
              months: termMonths,
              down: euro(quote.quote.downPaymentCents),
              monthly: euro(quote.quote.monthlyGrossCents),
            })}
          </p>
          <ApplicationWizard
            locale={locale}
            questions={questionsFile.questions}
            deal={{
              category: asset.category,
              financedAmountCents: quote.quote.financedCents,
              termMonths,
              startDate,
            }}
            coefficientTable={table}
            monthlyRentWithVatCents={quote.quote.monthlyGrossCents}
            storageKey={applicationStorageKey(
              asset.id,
              termMonths,
              downPaymentCents,
              startDate,
              principal?.id
            )}
            links={{
              item: itemHref,
              sign: `/${locale}/items/${asset.id}/sign?${leaseParams}&${new URLSearchParams({ quoted: quotedOn })}`,
              catalogue: `/${locale}`,
            }}
          />
        </>
      ) : (
        <div className="mt-6 max-w-xl">
          <InfoBox>
            <p role="status">{isLeasable(asset) ? t('apply.unavailable') : t('item.reserved')}</p>
          </InfoBox>
        </div>
      )}
    </div>
  );
}
