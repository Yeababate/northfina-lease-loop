// "Explain my price" and the side-by-side term comparison. Pure presentation: the numbers
// come from quoteLease in src/domain/pricing.ts, so what we show is what we charge.
import type { RentalDiscountRule } from '@/domain/discounts';
import type { CoefficientTable } from '@/data/schemas';
import { formatEuro } from '@/domain/money';
import { quoteLease, type LeaseQuote } from '@/domain/pricing';
import { formatIsoDate, formatNumber } from '@/i18n/format';
import type { Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';

export type VatChange = { ratePercent: number; validFrom: string };

type ExplainProps = {
  quote: LeaseQuote;
  nextVatChange: VatChange | null;
  locale: Locale;
  t: Translate;
};

export function PriceExplainer({ quote, nextVatChange, locale, t }: ExplainProps) {
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const rate = formatNumber(quote.vatRatePercent, locale);
  const rows: { label: string; value: string; strong?: boolean }[] = [
    { label: t('explain.listPrice'), value: euro(quote.listPriceCents) },
    { label: t('explain.downPayment'), value: `−${euro(quote.downPaymentCents)}` },
    { label: t('explain.financed'), value: euro(quote.financedCents) },
    {
      label: t('explain.factor', { band: quote.band.band, months: quote.termMonths }),
      value: `× ${formatNumber(quote.factor, locale)}`,
    },
    { label: t('discount.original'), value: euro(quote.originalMonthlyNetCents) },
    { label: t('discount.amount'), value: '−' + euro(quote.monthlyDiscountCents) },
    { label: t('explain.monthlyNet'), value: euro(quote.monthlyNetCents) },
    { label: t('explain.vat', { rate }), value: euro(quote.monthlyVatCents) },
    { label: t('explain.monthlyTotal'), value: euro(quote.monthlyGrossCents), strong: true },
    { label: t('explain.buyout'), value: euro(quote.buyoutCents) },
    { label: t('explain.total'), value: euro(quote.totalNetCents), strong: true },
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

type CompareProps = {
  table: CoefficientTable;
  discountRules?: readonly RentalDiscountRule[];
  terms: readonly number[];
  selectedTerm: number;
  listPriceCents: number;
  downPaymentCents: number;
  vatRatePercent: number;
  locale: Locale;
  t: Translate;
};

export function TermComparison(props: CompareProps) {
  const { table, terms, selectedTerm, locale, t } = props;
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const quotes = terms.map((termMonths) => ({
    termMonths,
    result: quoteLease(
      table,
      {
        listPriceCents: props.listPriceCents,
        downPaymentCents: props.downPaymentCents,
        termMonths,
        vatRatePercent: props.vatRatePercent,
      },
      props.discountRules
    ),
  }));

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-blue-700 underline underline-offset-2 dark:text-blue-300">
        {t('compare.toggle')}
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left tabular-nums">
          <caption className="sr-only">{t('compare.caption')}</caption>
          <thead className="text-stone-600 dark:text-stone-400">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">
                {t('compare.term')}
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">
                {t('compare.monthlyNet')}
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">
                {t('compare.monthlyGross')}
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">
                {t('compare.buyout')}
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                {t('compare.total')}
              </th>
            </tr>
          </thead>
          <tbody>
            {quotes.map(({ termMonths, result }) => {
              const selected = termMonths === selectedTerm;
              return (
                <tr
                  key={termMonths}
                  className={`border-t border-stone-200 dark:border-stone-800 ${selected ? 'bg-blue-50 font-semibold dark:bg-blue-950/60' : ''}`}
                >
                  <th scope="row" className="py-1.5 pr-3 font-medium">
                    {t('term.months', { months: termMonths })}
                    {selected ? <span className="sr-only"> ({t('compare.selected')})</span> : null}
                  </th>
                  {result.ok ? (
                    <>
                      <td className="py-1.5 pr-3 text-right">
                        {euro(result.quote.monthlyNetCents)}
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        {euro(result.quote.monthlyGrossCents)}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{euro(result.quote.buyoutCents)}</td>
                      <td className="py-1.5 text-right">{euro(result.quote.totalNetCents)}</td>
                    </>
                  ) : (
                    <td colSpan={4} className="py-1.5 text-right">
                      –
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
