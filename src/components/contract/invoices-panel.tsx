// Monthly invoices on the contract page, folded away by default: a one-line summary (how
// many, and the next one) with a "Download PDF" button, and the full table on request.
import type { Invoice } from '@/generated/prisma/client';
import { formatEuro } from '@/domain/money';
import { formatIsoDate } from '@/i18n/format';
import type { Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { InvoiceList } from '../invoice-list';
import { secondaryButton, textLink } from '../ui';

type InvoicesPanelProps = {
  contractId: string;
  actor: string;
  invoices: Invoice[];
  today: string;
  locale: Locale;
  t: Translate;
  /** Extra content at the end of the panel (the "Check the VAT on a date" fold-out). */
  children?: React.ReactNode;
};

export function InvoicesPanel(props: InvoicesPanelProps) {
  const { contractId, actor, invoices, today, locale, t } = props;
  const next = invoices.find((invoice) => invoice.invoiceDate >= today);
  const summary =
    invoices.length === 0
      ? t('invoices.empty')
      : next
        ? t('invoices.summary', {
            count: invoices.length,
            date: formatIsoDate(next.invoiceDate, locale),
            amount: formatEuro(next.grossCents, intlLocale[locale]),
          })
        : t('invoices.summaryDone', { count: invoices.length });

  return (
    <section
      id="invoices"
      aria-labelledby="invoices-panel-title"
      className="scroll-mt-6 rounded-2xl border border-stone-300 bg-white p-6 dark:border-stone-700 dark:bg-stone-900"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="invoices-panel-title" className="text-xl font-semibold">
            {t('invoices.title')}
          </h2>
          <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">{summary}</p>
        </div>
        {invoices.length > 0 ? (
          <a
            href={`/documents/contracts/${encodeURIComponent(contractId)}/invoices?locale=${locale}`}
            download
            className={`${secondaryButton} text-sm`}
          >
            <span aria-hidden="true">↓&nbsp;</span>
            {t('invoices.download')}
          </a>
        ) : null}
      </div>

      {invoices.length === 0 ? (
        // Nothing issued yet: show the generate button straight away, not behind a fold.
        <div className="mt-4">
          <InvoiceList
            invoices={invoices}
            contractId={contractId}
            actor={actor}
            locale={locale}
            showHeading={false}
          />
        </div>
      ) : (
        <details className="mt-4">
          <summary className={`${textLink} cursor-pointer text-sm`}>
            {t('invoices.showAll')}
          </summary>
          <div className="mt-3">
            <InvoiceList
              invoices={invoices}
              contractId={contractId}
              actor={actor}
              locale={locale}
              showHeading={false}
            />
          </div>
        </details>
      )}
      {props.children}
    </section>
  );
}
