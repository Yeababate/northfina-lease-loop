// How an early-exit price is built, step by step (card 8). A fair-exit-v2 quote shows every line
// of its breakdown (src/domain/fair-exit.ts); a quote stored with a v1 method keeps the one-line
// v1 explanation, because that is the rule it was priced with.
import { isFairExitQuote, type ExitQuote } from '@/domain/early-exit';
import { formatEuro } from '@/domain/money';
import { formatNumber } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';

type Props = { quote: ExitQuote; endOfTermBuyoutCents: number; locale: Locale };

export function ExitExplanation({ quote, endOfTermBuyoutCents, locale }: Props) {
  const t = getT(locale);
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const number = (value: number) => formatNumber(value, locale);
  if (!isFairExitQuote(quote)) {
    return (
      <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
        {t(`exit.${quote.kind}.how`, {
          months: quote.remainingMonths,
          rent: euro(quote.monthlyRentCents),
          buyout: euro(endOfTermBuyoutCents),
        })}
      </p>
    );
  }
  const b = quote.breakdown;
  const rows: { label: string; value: string; note?: string; total?: boolean }[] = [
    { label: t('exit.v2.remainingMonths'), value: number(b.remainingMonths) },
    {
      label: t('exit.v2.nominalRent', {
        months: b.remainingMonths,
        rent: euro(b.monthlyRentCents),
      }),
      value: euro(b.nominalRemainingRentCents),
    },
    { label: t('exit.v2.endBuyout'), value: euro(b.endOfTermBuyoutCents) },
    {
      label: t('exit.v2.discount', { rate: number(b.annualInterestPercent) }),
      value: `− ${euro(b.discountCents)}`,
    },
    { label: t('exit.v2.buyoutValue'), value: euro(b.buyoutValueCents), total: true },
  ];
  if (quote.kind === 'return') {
    rows.push({
      label: t('exit.v2.marketCredit'),
      value: `− ${euro(b.marketValueCreditCents)}`,
      note: b.valuedItems
        .map((item) =>
          t(`exit.v2.valued.${item.basis}`, {
            age: item.ageMonths,
            condition: t(`condition.${item.condition}`),
            usage: t(`usage.${item.usageUnit}`, { value: number(item.usageValue) }),
            value: euro(item.marketValueCents),
          })
        )
        .join(' '),
    });
  }
  rows.push(
    { label: t('exit.v2.net'), value: euro(b.netCents), total: true },
    { label: t('exit.v2.vat', { rate: number(b.vatRatePercent) }), value: euro(b.vatCents) },
    { label: t('exit.v2.gross'), value: euro(b.grossCents), total: true }
  );
  return (
    <div className="mt-2 text-sm">
      <p className="text-stone-600 dark:text-stone-400">{t(`exit.v2.why.${quote.kind}`)}</p>
      <dl className="mt-2 space-y-1">
        {rows.map((row) => (
          <div key={row.label}>
            <div
              className={`flex justify-between gap-3 ${row.total ? 'border-t border-stone-300 pt-1 font-semibold dark:border-stone-700' : ''}`}
            >
              <dt>{row.label}</dt>
              <dd className="tabular-nums">{row.value}</dd>
            </div>
            {row.note ? (
              <p className="text-xs text-stone-600 dark:text-stone-400">{row.note}</p>
            ) : null}
          </div>
        ))}
      </dl>
    </div>
  );
}
