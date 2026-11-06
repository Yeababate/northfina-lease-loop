// "Explain my price" and the side-by-side term comparison (#48). Pure presentation: every number
// comes from breakdown / compareOptions in src/domain/price-breakdown.ts (built on quoteLease),
// so what we show is what we charge, here and in GET /api/assets/:id/compare.
import type { CoefficientTable, VatRates } from '@/data/schemas';
import { percentText } from '@/domain/deals';
import type { RentalDiscountRule } from '@/domain/discounts';
import { formatEuro } from '@/domain/money';
import { compareOptions, type PriceBreakdown } from '@/domain/price-breakdown';
import { formatIsoDate, formatNumber } from '@/i18n/format';
import type { Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { Badge } from './ui';

export type VatChange = { ratePercent: number; validFrom: string };

type ExplainProps = {
  breakdown: PriceBreakdown;
  nextVatChange: VatChange | null;
  locale: Locale;
  t: Translate;
};

export function PriceExplainer({ breakdown, nextVatChange, locale, t }: ExplainProps) {
  const { quote } = breakdown;
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const rate = formatNumber(quote.vatRatePercent, locale);
  const signed = (cents: number) => (cents < 0 ? `−${euro(-cents)}` : `+${euro(cents)}`);
  const rows: { label: string; value: string; strong?: boolean }[] = [
    { label: t('explain.listPrice'), value: euro(quote.listPriceCents) },
    { label: t('explain.downPayment'), value: `−${euro(quote.downPaymentCents)}` },
    { label: t('explain.financed'), value: euro(quote.financedCents) },
    {
      label: t('explain.factor', { band: quote.band.band, months: quote.termMonths }),
      value: `× ${factorText(quote.factor, locale)} (${percentText(breakdown.monthlyFactorBps, intlLocale[locale])} %)`,
    },
    { label: t('discount.original'), value: euro(quote.originalMonthlyNetCents) },
    { label: t('discount.amount'), value: '−' + euro(quote.monthlyDiscountCents) },
    { label: t('explain.monthlyNet'), value: euro(quote.monthlyNetCents) },
    { label: t('explain.vat', { rate }), value: euro(quote.monthlyVatCents) },
    { label: t('explain.monthlyTotal'), value: euro(quote.monthlyGrossCents), strong: true },
    { label: t('explain.buyout'), value: euro(quote.buyoutCents) },
    { label: t('explain.total'), value: euro(breakdown.totalNetCents), strong: true },
    ...(breakdown.totalGrossCents === null
      ? []
      : [{ label: t('explain.totalGross'), value: euro(breakdown.totalGrossCents) }]),
    { label: t('explain.ifKept'), value: euro(breakdown.totalIfKeptNetCents) },
    { label: t('explain.vsBuying'), value: signed(breakdown.costOfLeasingNetCents) },
  ];

  return (
    <details open className="group border-t border-stone-200 pt-4 dark:border-stone-800">
      <summary className="cursor-pointer font-semibold">{t('explain.title')}</summary>
      <dl className="mt-3 space-y-1.5 text-sm">
        {rows.map((row) => (
          <div
            key={row.label}
            className={`flex justify-between gap-4 ${row.strong ? 'font-semibold' : ''}`}
          >
            <dt>{row.label}</dt>
            <dd className="text-right tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 space-y-2 text-xs text-stone-600 dark:text-stone-400">
        <p>{t('explain.totalHint', { months: quote.termMonths })}</p>
        <p>{t('explain.formula')}</p>
        <p>
          {nextVatChange
            ? t('explain.vatChange', {
                rate: formatNumber(nextVatChange.ratePercent, locale),
                date: formatIsoDate(nextVatChange.validFrom, locale),
              })
            : t('explain.vatSame')}
        </p>
      </div>
    </details>
  );
}

/** The factor with all six of its decimals (0.027584), not the default three (0.028). */
function factorText(factor: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale[locale], { maximumFractionDigits: 6 }).format(factor);
}

type CompareProps = {
  table: CoefficientTable;
  discountRules?: readonly RentalDiscountRule[];
  terms: readonly number[];
  selectedTerm: number;
  listPriceCents: number;
  downPaymentCents: number;
  vat: VatRates;
  startOn: string;
  /** Choosing a card moves the term slider to that term. */
  onSelect: (termMonths: number) => void;
  locale: Locale;
  t: Translate;
};

/** At most this many terms fit side by side; the comparison takes the first ones. */
const MAX_CARDS = 4;

export function TermComparison(props: CompareProps) {
  const { selectedTerm, locale, t } = props;
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const terms = props.terms.slice(0, MAX_CARDS);
  if (terms.length < 2) return null;
  const comparison = compareOptions(
    {
      table: props.table,
      discountRules: props.discountRules,
      listPriceCents: props.listPriceCents,
      vat: props.vat,
      startOn: props.startOn,
    },
    terms.map((termMonths) => ({ termMonths, downPaymentCents: props.downPaymentCents }))
  );
  const chosen = comparison.options.find((option) => option.termMonths === selectedTerm);
  const difference = (cents: number, more: 'compare.moreMonthly' | 'compare.moreTotal') =>
    cents === 0
      ? null
      : cents > 0
        ? t(more, { amount: euro(cents) })
        : t(more === 'compare.moreMonthly' ? 'compare.lessMonthly' : 'compare.lessTotal', {
            amount: euro(-cents),
          });

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-blue-700 underline underline-offset-2 dark:text-blue-300">
        {t('compare.toggle')}
      </summary>
      <p className="mt-2 text-stone-600 dark:text-stone-400">
        {t('compare.basis', { down: euro(props.downPaymentCents) })}
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {comparison.options.map((option, index) => {
          const selected = option.termMonths === selectedTerm;
          return (
            <li key={option.termMonths}>
              <button
                type="button"
                onClick={() => props.onSelect(option.termMonths)}
                aria-pressed={selected}
                disabled={!option.ok}
                className={
                  'flex h-full w-full flex-col items-start rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ' +
                  (selected
                    ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600 dark:border-blue-400 dark:bg-blue-950/60 dark:ring-blue-400'
                    : 'border-stone-300 hover:border-stone-500 dark:border-stone-700 dark:hover:border-stone-500')
                }
              >
                <span className="font-semibold">
                  {t('term.months', { months: option.termMonths })}
                </span>
                {option.ok ? (
                  <>
                    <span className="mt-1 text-base font-bold tabular-nums">
                      {euro(option.breakdown.quote.monthlyNetCents)}
                    </span>
                    <span className="text-xs text-stone-600 dark:text-stone-400">
                      {t('compare.perMonth')}
                    </span>
                    <span className="mt-2 font-semibold tabular-nums">
                      {euro(option.breakdown.totalNetCents)}
                    </span>
                    <span className="text-xs text-stone-600 dark:text-stone-400">
                      {t('compare.totalLabel')}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1">
                      {comparison.lowestMonthly === index ? (
                        <Badge tone="green">{t('compare.lowestMonthly')}</Badge>
                      ) : null}
                      {comparison.lowestTotal === index ? (
                        <Badge tone="blue">{t('compare.lowestTotal')}</Badge>
                      ) : null}
                    </span>
                    {selected ? (
                      <span className="mt-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
                        {t('compare.yourChoice')}
                      </span>
                    ) : chosen?.ok ? (
                      <span className="mt-1 text-xs text-stone-600 dark:text-stone-400">
                        {[
                          difference(
                            option.breakdown.quote.monthlyNetCents -
                              chosen.breakdown.quote.monthlyNetCents,
                            'compare.moreMonthly'
                          ),
                          difference(
                            option.breakdown.totalNetCents - chosen.breakdown.totalNetCents,
                            'compare.moreTotal'
                          ),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="mt-1 text-xs">{t('compare.notPossible')}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
