import { formatEuro } from '@/domain/money';
import { getT } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';

/** Both amounts stay visible. Registration changes prominence, never the VAT charged. */
export function MonthlyPrice(props: {
  netCents: number;
  grossCents: number;
  basis: 'net' | 'gross';
  locale: Locale;
}) {
  const t = getT(props.locale);
  const euro = (value: number) => formatEuro(value, intlLocale[props.locale]);
  const netFirst = props.basis === 'net';
  return (
    <div aria-live="polite" className="rounded-xl bg-blue-50 px-5 py-4 dark:bg-blue-950/60">
      <p className="text-2xl font-bold tabular-nums">
        {t(netFirst ? 'pricing.monthlyNet' : 'pricing.monthlyGross', {
          amount: euro(netFirst ? props.netCents : props.grossCents),
        })}
      </p>
      <p className="mt-1 text-sm">
        {t(netFirst ? 'pricing.monthlyGross' : 'pricing.monthlyNet', {
          amount: euro(netFirst ? props.grossCents : props.netCents),
        })}
      </p>
      {netFirst ? <p className="mt-2 text-sm">{t('pricing.registeredNote')}</p> : null}
    </div>
  );
}
