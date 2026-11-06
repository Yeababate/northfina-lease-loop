import { formatEuro } from '@/domain/money';
import { getT } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';

export function DiscountBreakdown({
  price,
  locale,
}: {
  price: {
    originalMonthlyNetCents: number;
    monthlyDiscountCents: number;
    monthlyNetCents: number;
    discountBps: number;
  };
  locale: Locale;
}) {
  const t = getT(locale);
  const money = (value: number) => formatEuro(value, intlLocale[locale]);
  return (
    <div className="my-4 rounded-lg border border-emerald-200 p-3 text-sm" aria-live="polite">
      <dl className="space-y-1">
        <div className="flex justify-between gap-4">
          <dt>{t('discount.original')}</dt>
          <dd>{money(price.originalMonthlyNetCents)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>
            {t('discount.amount')} ({price.discountBps / 100}%)
          </dt>
          <dd>−{money(price.monthlyDiscountCents)}</dd>
        </div>
        <div className="flex justify-between gap-4 font-semibold">
          <dt>{t('discount.final')}</dt>
          <dd>{money(price.monthlyNetCents)}</dd>
        </div>
      </dl>
      <p className="mt-2">{t('discount.policy')}</p>
    </div>
  );
}
