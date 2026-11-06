// Application and decision for one item and lease choice. The term, down payment and start
// date come from the item page's URL; the server re-prices them, so a hand-edited URL can
// never get a price the calculator would not give.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { DiscountBreakdown } from '@/components/discount-breakdown';
import { ApplicationWizard } from '@/components/application/application-wizard';
import { applicationStorageKey } from '@/components/application/storage-key';
import { InfoBox, textLink } from '@/components/ui';
import { loadCoefficientTable, loadPriceLists, loadQuestions, loadVatRates } from '@/data/load';
import { isLeasable, parseCatalogueQuery } from '@/domain/catalogue';
import { unavailableMessage } from '@/components/unavailable-message';
import { VatNote } from '@/components/vat-note';
import { isIsoDate } from '@/domain/iso-date';
import { formatEuro } from '@/domain/money';
import { listPriceOn } from '@/domain/price-list';
import { availableTerms, DEFAULT_TERM_MONTHS, quoteLease } from '@/domain/pricing';
import { vatRateOn } from '@/domain/vat';
import { getT } from '@/i18n/get-t';
import { intlLocale, isLocale } from '@/i18n/locales';
import { assetPriceOverride, toAsset } from '@/server/assets';
import { db } from '@/server/db';
import { rulesForAsset } from '@/server/discount-rules';
import { readDemoName } from '@/server/demo-session';
import { todayIso } from '@/server/today';
import { currentPrincipal } from '@/server/current-principal';
import { rememberedSetsFor } from '@/server/catalogue-readiness';

export default async function ApplyPage({
  params,
  searchParams,
}: PageProps<'/[locale]/items/[assetId]/apply'>) {
  const { locale, assetId } = await params;
  if (!isLocale(locale)) notFound();
  await connection();

  const [assetRow, priceLists, table, vatRates, questionsFile] = await Promise.all([
    db.asset.findUnique({ where: { id: assetId } }),
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
    loadQuestions(),
  ]);
  if (!assetRow) notFound();
  const asset = toAsset(assetRow);
  const discountRules = await rulesForAsset(db, assetId);

  const t = getT(locale);
  const principal = await currentPrincipal();
  const today = todayIso();
  const demoName = await readDemoName();
  const remembered = await rememberedSetsFor(
    db,
    principal?.id ?? null,
    questionsFile.questions,
    today
  );
  const query = await searchParams;
  const parsed = parseCatalogueQuery(query, {
    today,
    terms: availableTerms(table),
    defaultTerm: DEFAULT_TERM_MONTHS,
  });
  const quoteId = typeof query.quoteId === 'string' ? query.quoteId : null;
  const savedQuote = quoteId ? await db.quote.findUnique({ where: { id: quoteId } }) : null;
  const quoteConfigMatches = savedQuote
    ? principal?.id === savedQuote.renterId &&
      savedQuote.assetId === asset.id &&
      query.term === String(savedQuote.termMonths) &&
      query.down === String(savedQuote.downPaymentCents) &&
      query.start === savedQuote.startOn
    : false;
  const termMonths = savedQuote && quoteConfigMatches ? savedQuote.termMonths : parsed.termMonths;
  const startDate = savedQuote && quoteConfigMatches ? savedQuote.startOn : parsed.startDate;
  // The day the customer saw the price, for "Why this price?" when signing. Never after today.
  const quotedText = typeof query.quoted === 'string' ? query.quoted : '';
  const quotedOn = isIsoDate(quotedText) && quotedText <= today ? quotedText : today;
  const downText = typeof query.down === 'string' ? query.down : '0';
  const downPaymentCents = /^\d{1,12}$/.test(downText) ? Number(downText) : -1;

  const price = listPriceOn(priceLists, asset.id, today, assetPriceOverride(assetRow));
  const vat = vatRateOn(vatRates.rates, startDate);
  const calculated =
    !savedQuote && price.ok && vat.ok && isLeasable(asset)
      ? quoteLease(
          table,
          {
            listPriceCents: price.priceCents,
            downPaymentCents,
            termMonths,
            vatRatePercent: vat.rate.rate_percent,
          },
          discountRules
        )
      : null;
  const quote =
    savedQuote !== null && quoteConfigMatches
      ? {
          downPaymentCents: savedQuote.downPaymentCents,
          financedCents: savedQuote.financedCents,
          termMonths: savedQuote.termMonths,
          originalMonthlyNetCents: savedQuote.originalMonthlyNetCents,
          monthlyDiscountCents: savedQuote.monthlyDiscountCents,
          discountBps: savedQuote.discountBps,
          monthlyNetCents: savedQuote.monthlyNetCents,
          monthlyGrossCents: savedQuote.monthlyGrossCents,
          buyoutCents: savedQuote.buyoutNetCents,
        }
      : calculated?.ok
        ? calculated.quote
        : null;

  const leaseParams = new URLSearchParams({
    term: String(termMonths),
    down: String(downPaymentCents),
    start: startDate,
  });
  const itemHref = `/${locale}/items/${asset.id}?${new URLSearchParams({ term: String(termMonths), start: startDate })}`;
  const name = `${asset.make} ${asset.model}`;
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href={itemHref} className={textLink}>
        ← {t('apply.back', { name })}
      </Link>

      {quote ? (
        <div className="mt-4">
          <ApplicationWizard
            intro={
              // The price and the VAT note sit together, before the first question.
              <div className="mb-6 max-w-xl">
                <p className="text-sm text-stone-600 dark:text-stone-400">
                  {t('apply.deal', {
                    months: termMonths,
                    down: euro(quote.downPaymentCents),
                    monthly: euro(quote.monthlyGrossCents),
                  })}
                </p>
                <VatNote rates={vatRates.rates} on={today} locale={locale} className="mt-1" />
                <DiscountBreakdown price={quote} locale={locale} />
              </div>
            }
            locale={locale}
            questions={questionsFile.questions}
            deal={{
              category: asset.category,
              financedAmountCents: quote.financedCents,
              termMonths,
              startDate,
            }}
            coefficientTable={table}
            monthlyRentWithVatCents={quote.monthlyGrossCents}
            storageKey={applicationStorageKey(
              asset.id,
              termMonths,
              downPaymentCents,
              startDate,
              principal?.id
            )}
            prefill={demoName ? { q_full_name: demoName } : undefined}
            remembered={remembered}
            links={{
              item: itemHref,
              sign: `/${locale}/items/${asset.id}/sign?${leaseParams}${
                savedQuote ? `&quoteId=${encodeURIComponent(savedQuote.id)}` : `&quoted=${quotedOn}`
              }`,
              catalogue: `/${locale}`,
            }}
          />
        </div>
      ) : (
        <div className="mt-6 max-w-xl">
          <InfoBox>
            <p role="status">
              {quoteId && !quoteConfigMatches
                ? t('quote.invalid')
                : isLeasable(asset)
                  ? t('apply.unavailable')
                  : unavailableMessage(asset, t)}
            </p>
          </InfoBox>
        </div>
      )}
    </div>
  );
}
