// One line on how VAT works, shared by every page that shows a lease price (the application
// now, signing and invoices later): net prices exclude VAT, and each invoice adds VAT at the
// rate on its own invoice date. The rates come from data/vat-rates.json through
// vatOutlookOn, so a new rate in the data pack changes the wording without code changes.
//
// No hooks and no client JavaScript, so it renders in server and client components alike.
import type { VatRate } from '@/data/schemas';
import { vatOutlookOn } from '@/domain/vat';
import { formatIsoDate, formatNumber } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';

type VatNoteProps = {
  rates: readonly VatRate[];
  /** "Today" as YYYY-MM-DD, from todayIso() on the server. Never read the clock here. */
  on: string;
  locale: Locale;
  className?: string;
};

export function VatNote({ rates, on, locale, className = '' }: VatNoteProps) {
  const t = getT(locale);
  const { currentPercent, next } = vatOutlookOn(rates, on);
  const rate = (percent: number) => formatNumber(percent, locale);

  const text =
    currentPercent === null
      ? t('vatNote.unknown')
      : next
        ? t('vatNote.change', {
            now: rate(currentPercent),
            next: rate(next.ratePercent),
            date: formatIsoDate(next.validFrom, locale),
          })
        : t('vatNote.same', { now: rate(currentPercent) });

  return <p className={`text-sm text-stone-700 dark:text-stone-300 ${className}`}>{text}</p>;
}
