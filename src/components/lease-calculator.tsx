'use client';

// "Choose your lease": term and down payment sliders with a live monthly price. Every number
// comes from quoteLease (src/domain/pricing.ts), the same tested function the server will use
// when the contract is signed, so the preview and the contract cannot disagree.
import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { dealTiers, percentText, termDiscounts } from '@/domain/deals';
import type { RentalDiscountRule } from '@/domain/discounts';
import { downPaymentAtStep } from '@/domain/dealer-discount';
import { DiscountBreakdown } from './discount-breakdown';
import type { CoefficientTable, VatRates } from '@/data/schemas';
import { breakdown } from '@/domain/price-breakdown';
import { formatEuro } from '@/domain/money';
import {
  availableTerms,
  maxDownPaymentCents,
  minDownPaymentCents,
  quoteLease,
} from '@/domain/pricing';
import { formatIsoDate, formatNumber } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { PriceExplainer, TermComparison, type VatChange } from './price-explainer';
import { primaryButton } from './ui';

type LeaseCalculatorProps = {
  locale: Locale;
  table: CoefficientTable;
  discountRules?: readonly RentalDiscountRule[];
  listPriceCents: number;
  providerName?: string;
  /** VAT rate on the lease start date. */
  vatRatePercent: number;
  /** The whole VAT table, so totals use the rate on each invoice date. */
  vatRates: VatRates;
  nextVatChange: VatChange | null;
  initialTerm: number;
  startDate: string;
  /** Today: the day this price was shown, so signing can explain a price-list change. */
  quotedOn: string;
  /** The application page; term, down payment and start date are added as query params. */
  applyPath: string;
  /** Photo, facts and list price: rendered on the server, shown above the apply button. */
  summary: ReactNode;
  /** Rendered on the server and shown under the apply button (the CO2 "Your impact" panel). */
  afterApply?: ReactNode;
};

/** The down payment slider moves in whole euros. */
const DOWN_PAYMENT_STEP_CENTS = 100;

export function LeaseCalculator(props: LeaseCalculatorProps) {
  const { locale, table, listPriceCents, vatRatePercent } = props;
  const t = getT(locale);
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const termId = useId();
  const downId = useId();

  const terms = availableTerms(table);
  const minDown = minDownPaymentCents(table, listPriceCents);
  const maxDown = maxDownPaymentCents(table, listPriceCents);
  const [termIndex, setTermIndex] = useState(() => Math.max(0, terms.indexOf(props.initialTerm)));
  const [downStep, setDownStep] = useState(0);
  const downPaymentCents = downPaymentAtStep(minDown, maxDown, downStep);
  const termMonths = terms[termIndex] ?? terms[0] ?? 0;
  // Long-term discounts, worked out with the same rule choice as the price itself.
  const discountByTerm = new Map(
    termDiscounts(props.discountRules ?? [], terms).map((row) => [row.termMonths, row.discountBps])
  );
  const tiers = dealTiers(props.discountRules ?? [], terms);
  const bestTier = tiers.toSorted((a, b) => b.discountBps - a.discountBps)[0];
  const currentBps = discountByTerm.get(termMonths) ?? 0;
  const percent = (bps: number) => percentText(bps, intlLocale[locale]);

  const result = quoteLease(
    table,
    {
      listPriceCents,
      downPaymentCents,
      termMonths,
      vatRatePercent,
    },
    props.discountRules
  );
  const minimumFinanced = Math.min(...table.bands.map((b) => b.min_financed_cents));
  const maximumFinanced = Math.max(...table.bands.map((b) => b.max_financed_cents));
  const tooCheap = listPriceCents < minimumFinanced;

  const applyHref = `${props.applyPath}?${new URLSearchParams({
    term: String(termMonths),
    down: String(downPaymentCents),
    start: props.startDate,
    quoted: props.quotedOn,
  })}`;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
      <div>
        {props.summary}
        {result.ok ? (
          <>
            <Link href={applyHref} className={`${primaryButton} mt-4 w-full`}>
              {t('item.apply')}
            </Link>
            <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">{t('item.applyNote')}</p>
          </>
        ) : null}
        {props.afterApply ? <div className="mt-6">{props.afterApply}</div> : null}
      </div>

      <section
        aria-labelledby="choose-lease"
        className="space-y-5 rounded-2xl border border-stone-300 p-6 dark:border-stone-700"
      >
        <h2 id="choose-lease" className="text-xl font-semibold">
          {t('lease.choose')}
        </h2>

        {props.providerName && <p>{t('discount.itemProvider', { name: props.providerName })}</p>}
        {tooCheap ? (
          <p role="alert">{t('lease.tooCheap', { min: euro(minimumFinanced) })}</p>
        ) : (
          <>
            {minDown > 0 ? (
              <p className="text-sm">
                {t('lease.needsDown', { max: euro(maximumFinanced), down: euro(minDown) })}
              </p>
            ) : null}

            {bestTier ? (
              <p
                aria-live="polite"
                className="flex gap-2 rounded-xl bg-green-50 px-4 py-2.5 text-sm text-green-900 dark:bg-green-950/50 dark:text-green-100"
              >
                <span aria-hidden="true">🏷</span>
                <span>
                  {currentBps > 0
                    ? t('deals.hintApplied', { percent: percent(currentBps) })
                    : bestTier.toTermMonths === null
                      ? t('deals.hintFrom', {
                          months: bestTier.fromTermMonths,
                          percent: percent(bestTier.discountBps),
                        })
                      : t('deals.hintRange', {
                          from: bestTier.fromTermMonths,
                          to: bestTier.toTermMonths,
                          percent: percent(bestTier.discountBps),
                        })}
                </span>
              </p>
            ) : null}

            <div>
              <div className="flex justify-between font-semibold">
                <label htmlFor={termId}>{t('lease.term')}</label>
                <output htmlFor={termId}>{t('term.months', { months: termMonths })}</output>
              </div>
              <input
                id={termId}
                type="range"
                min={0}
                max={terms.length - 1}
                step={1}
                value={termIndex}
                aria-valuetext={
                  currentBps > 0
                    ? `${t('term.months', { months: termMonths })}, ${t('deals.mark', { percent: percent(currentBps) })}`
                    : t('term.months', { months: termMonths })
                }
                onChange={(event) => setTermIndex(Number(event.target.value))}
                className="mt-2 w-full accent-blue-600"
              />
              <div aria-hidden="true" className="flex justify-between text-sm text-stone-600">
                {terms.map((months) => {
                  const bps = discountByTerm.get(months) ?? 0;
                  return (
                    <span
                      key={months}
                      className="flex flex-col items-center first:items-start last:items-end"
                    >
                      <span>{months}</span>
                      {bps > 0 ? (
                        <span className="text-xs font-semibold text-green-700 dark:text-green-400">
                          {t('deals.mark', { percent: percent(bps) })}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex justify-between font-semibold">
                <label htmlFor={downId}>{t('lease.downPayment')}</label>
                <output htmlFor={downId} className="tabular-nums">
                  {euro(downPaymentCents)}
                </output>
              </div>
              <input
                id={downId}
                type="range"
                min={0}
                max={Math.ceil((maxDown - minDown) / DOWN_PAYMENT_STEP_CENTS)}
                step={1}
                value={downStep}
                aria-valuetext={euro(downPaymentCents)}
                onChange={(event) => setDownStep(Number(event.target.value))}
                className="mt-2 w-full accent-blue-600"
              />
              <div className="flex justify-between gap-2 text-sm text-stone-600 dark:text-stone-400">
                <span aria-hidden="true">{euro(minDown)}</span>
                {result.ok ? (
                  <span>{t('lease.financed', { amount: euro(result.quote.financedCents) })}</span>
                ) : null}
                <span aria-hidden="true">{euro(maxDown)}</span>
              </div>
            </div>

            {result.ok ? (
              <>
                <DiscountBreakdown price={result.quote} locale={locale} />
                <div
                  aria-live="polite"
                  className="rounded-xl bg-blue-50 px-5 py-4 dark:bg-blue-950/60"
                >
                  <p>
                    <span className="text-4xl font-bold tabular-nums">
                      {euro(result.quote.monthlyNetCents)}
                    </span>{' '}
                    <span className="text-stone-700 dark:text-stone-300">
                      {t('lease.perMonthNet')}
                    </span>
                  </p>
                  <p className="mt-1">
                    {t('lease.withVat', {
                      amount: euro(result.quote.monthlyGrossCents),
                      rate: formatNumber(vatRatePercent, locale),
                    })}
                  </p>
                  <p>{t('lease.buyout', { amount: euro(result.quote.buyoutCents) })}</p>
                </div>
                <p className="text-xs text-stone-600 dark:text-stone-400">
                  {t('lease.startsOn', { date: formatIsoDate(props.startDate, locale) })}
                </p>
                <TermComparison
                  table={table}
                  discountRules={props.discountRules}
                  terms={terms}
                  selectedTerm={termMonths}
                  listPriceCents={listPriceCents}
                  downPaymentCents={downPaymentCents}
                  vat={props.vatRates}
                  startOn={props.startDate}
                  onSelect={(months) => setTermIndex(Math.max(0, terms.indexOf(months)))}
                  locale={locale}
                  t={t}
                />
                <PriceExplainer
                  breakdown={breakdown(result.quote, props.vatRates, props.startDate)}
                  nextVatChange={props.nextVatChange}
                  locale={locale}
                  t={t}
                />
              </>
            ) : (
              <p role="alert">{t('lease.unavailable')}</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
