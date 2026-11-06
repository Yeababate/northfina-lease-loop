import type { Invoice } from '@/generated/prisma/client';
import { formatEuro } from '@/domain/money';
import { getT } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { GenerateInvoices } from './generate-invoices';

export function InvoiceList({
  invoices,
  contractId,
  actor,
  locale,
  showHeading = true,
}: {
  invoices: Invoice[];
  contractId: string;
  actor: string;
  locale: Locale;
  /** False when a surrounding panel already shows the title and the "none yet" text. */
  showHeading?: boolean;
}) {
  const t = getT(locale);
  const money = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const totals = invoices.reduce(
    (sum, row) => ({
      net: sum.net + row.netCents,
      vat: sum.vat + row.vatCents,
      gross: sum.gross + row.grossCents,
    }),
    { net: 0, vat: 0, gross: 0 }
  );
  return (
    <section
      className={showHeading ? 'space-y-4' : 'space-y-3 text-sm'}
      aria-labelledby={showHeading ? 'invoices-title' : undefined}
      aria-label={showHeading ? undefined : t('invoices.title')}
    >
      {showHeading ? (
        <h2 id="invoices-title" className="text-xl font-semibold">
          {t('invoices.title')}
        </h2>
      ) : null}
      <p>{t('invoices.policy')}</p>
      <p>{t('invoices.separate')}</p>
      {invoices.length === 0 ? (
        <>
          {showHeading ? <p>{t('invoices.empty')}</p> : null}
          <GenerateInvoices contractId={contractId} actor={actor} locale={locale} />
        </>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <caption className="sr-only">{t('invoices.title')}</caption>
            <thead>
              <tr>
                {(['period', 'date', 'due', 'net', 'vat', 'gross'] as const).map((key) => (
                  <th className="p-2" scope="col" key={key}>
                    {t(`invoices.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((row) => (
                <tr className="border-t" key={row.id}>
                  <th scope="row" className="p-2">
                    {row.period}
                  </th>
                  <td className="p-2 whitespace-nowrap">{row.invoiceDate}</td>
                  <td className="p-2 whitespace-nowrap">{row.dueDate}</td>
                  <td className="p-2">{money(row.netCents)}</td>
                  <td className="p-2">
                    {money(row.vatCents)} ({row.vatPercent}%)
                  </td>
                  <td className="p-2">{money(row.grossCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-semibold">
                <th colSpan={3} scope="row" className="p-2">
                  {t('invoices.total')}
                </th>
                <td className="p-2">{money(totals.net)}</td>
                <td className="p-2">{money(totals.vat)}</td>
                <td className="p-2">{money(totals.gross)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
