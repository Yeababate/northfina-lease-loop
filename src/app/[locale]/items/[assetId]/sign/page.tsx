// Review and sign (wireframe 5). Prices the lease for today, the signing day, and explains
// the lock: which price list applies and why, and that VAT is not part of it. Signing itself
// goes through POST /api/contracts, which decides the application again on the server.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ReviewAndSign } from '@/components/application/review-and-sign';
import { applicationStorageKey } from '@/components/application/storage-key';
import { InfoBox, textLink } from '@/components/ui';
import { loadCoefficientTable, loadPriceLists, loadQuestions, loadVatRates } from '@/data/load';
import { priceLockNote } from '@/domain/application-signing';
import { isLeasable, parseCatalogueQuery } from '@/domain/catalogue';
import { priceContract } from '@/domain/contract-pricing';
import { isIsoDate } from '@/domain/iso-date';
import { formatEuro } from '@/domain/money';
import { availableTerms, DEFAULT_TERM_MONTHS } from '@/domain/pricing';
import { nextVatChangeAfter, vatCents, vatRateOn } from '@/domain/vat';
import { formatIsoDate, formatNumber } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import { intlLocale, isLocale } from '@/i18n/locales';
import { getAsset } from '@/server/assets';
import { db } from '@/server/db';
import { todayIso } from '@/server/today';

export default async function SignPage({
  params,
  searchParams,
}: PageProps<'/[locale]/items/[assetId]/sign'>) {
  const { locale, assetId } = await params;
  if (!isLocale(locale)) notFound();
  await connection();

  const [asset, lists, table, vatRates, questionsFile] = await Promise.all([
    getAsset(db, assetId),
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
    loadQuestions(),
  ]);
  if (!asset) notFound();

  const t = getT(locale);
  const today = todayIso();
  const query = await searchParams;
  const { termMonths, startDate } = parseCatalogueQuery(query, {
    today,
    terms: availableTerms(table),
    defaultTerm: DEFAULT_TERM_MONTHS,
  });
  const downText = typeof query.down === 'string' ? query.down : '0';
  const downPaymentCents = /^\d{1,12}$/.test(downText) ? Number(downText) : -1;
  const quotedText = typeof query.quoted === 'string' ? query.quoted : '';
  const quotedOn = isIsoDate(quotedText) && quotedText <= today ? quotedText : today;

  const leaseParams = new URLSearchParams({
    term: String(termMonths),
    down: String(downPaymentCents),
    start: startDate,
    quoted: quotedOn,
  });
  const applyHref = `/${locale}/items/${asset.id}/apply?${leaseParams}`;
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);

  // Today's price is the one that locks; the quote is only compared with it.
  const pricing = { assetId: asset.id, termMonths, downPaymentCents, startOn: startDate };
  const locked = priceContract(lists, table, pricing, today);
  const startVat = vatRateOn(vatRates.rates, startDate);
  if (!isLeasable(asset) || !locked.ok || !startVat.ok) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
        <Link href={applyHref} className={textLink}>
          ← {t('apply.back', { name: `${asset.make} ${asset.model}` })}
        </Link>
        <div className="mt-6">
          <InfoBox>
            <p role="status">{isLeasable(asset) ? t('sign.unavailable') : t('item.reserved')}</p>
          </InfoBox>
        </div>
      </div>
    );
  }

  const price = locked.price;
  const quoted = priceContract(lists, table, pricing, quotedOn);
  const note = quoted.ok ? priceLockNote(quoted.price, price) : null;
  const listDate = lists.find((list) => list.version === price.priceListVersion)?.valid_from;
  const nowVat = vatRateOn(vatRates.rates, today);
  const nextVat = nextVatChangeAfter(vatRates.rates, today);
  const rate = (percent: number) => formatNumber(percent, locale);

  const explanations = (
    <>
      <InfoBox title={t('sign.whyPrice')}>
        <p>
          {t('sign.lockedFrom', {
            amount: euro(price.monthlyNetCents),
            date: listDate ? formatIsoDate(listDate, locale) : '–',
          })}
        </p>
        {note?.listChanged ? (
          <p className="mt-1">
            {t(
              note.direction === 'lower'
                ? 'sign.listChangedLower'
                : note.direction === 'higher'
                  ? 'sign.listChangedHigher'
                  : 'sign.listChangedSame',
              {
                quoted: formatIsoDate(quotedOn, locale),
                difference: euro(note.differenceCents),
              }
            )}
          </p>
        ) : null}
      </InfoBox>
      <div className="rounded-xl bg-orange-50 px-4 py-3 text-sm text-stone-800 dark:bg-orange-950/50 dark:text-stone-200">
        <p className="font-semibold">{t('sign.vatTitle')}</p>
        <p className="mt-0.5">
          {nowVat.ok && nextVat
            ? t('sign.vatChange', {
                now: rate(nowVat.rate.rate_percent),
                next: rate(nextVat.rate_percent),
                date: formatIsoDate(nextVat.valid_from, locale),
              })
            : t('sign.vatSame', { now: nowVat.ok ? rate(nowVat.rate.rate_percent) : '–' })}
        </p>
      </div>
    </>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href={applyHref} className={textLink}>
        ← {t('apply.back', { name: `${asset.make} ${asset.model}` })}
      </Link>
      <div className="mt-4">
        <ReviewAndSign
          key={JSON.stringify([
            asset.id,
            termMonths,
            downPaymentCents,
            startDate,
            price.monthlyNetCents,
            price.buyoutNetCents,
            price.priceListVersion,
            startVat.rate.rate_percent,
          ])}
          locale={locale}
          lease={{
            assetId: asset.id,
            itemName: `${asset.make} ${asset.model}`,
            termMonths,
            downPaymentCents,
            startOn: startDate,
            monthlyNetCents: price.monthlyNetCents,
            buyoutCents: price.buyoutNetCents,
            priceListVersion: price.priceListVersion,
          }}
          storageKey={applicationStorageKey(asset.id, termMonths, downPaymentCents, startDate)}
          questions={questionsFile.questions}
          deal={{
            category: asset.category,
            financedAmountCents: price.financedCents,
            termMonths,
            startDate,
          }}
          coefficientTable={table}
          monthlyRentWithVatCents={
            price.monthlyNetCents + vatCents(price.monthlyNetCents, startVat.rate.rate_percent)
          }
          explanations={explanations}
          applyHref={applyHref}
        />
      </div>
    </div>
  );
}
