import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { isoDateSchema } from '@/data/schemas';
import { loadVatRates } from '@/data/load';
import { invoicePrice } from '@/domain/contract-pricing';
import { formatEuro } from '@/domain/money';
import { getT } from '@/i18n/get-t';
import { intlLocale, isLocale } from '@/i18n/locales';
import { db } from '@/server/db';
import { todayIso } from '@/server/today';
import { currentPrincipal } from '@/server/current-principal';
import { getParticipantContract } from '@/server/profile';
import { ApiError } from '@/server/api-response';
import { InvoiceList } from '@/components/invoice-list';

export default async function ContractPage({
  params,
  searchParams,
}: PageProps<'/[locale]/contracts/[id]'>) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  await connection();
  const principal = await currentPrincipal();
  if (!principal) notFound();
  const contract = await getParticipantContract(db, principal.id, id).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  const document = await db.contractDocument.findUnique({
    where: { contractId: id },
    select: { locale: true },
  });
  const invoices = await db.invoice.findMany({
    where: { contractId: id },
    orderBy: { period: 'asc' },
  });
  const t = getT(locale);
  const query = await searchParams;
  const date = isoDateSchema.safeParse(query.invoiceDate ?? todayIso());
  const invoice = date.success ? invoicePrice(contract, await loadVatRates(), date.data) : null;
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-8">
      <h1 className="text-2xl">{t('contract.title')}</h1>
      <p>{contract.assetId}</p>
      <p>{t('contract.rule')}</p>
      <p>
        {t('contract.monthly', {
          amount: formatEuro(contract.monthlyNetCents, intlLocale[locale]),
        })}
      </p>
      <p>{t('contract.period', { start: contract.startOn, end: contract.endOn })}</p>
      <p>{t('asset.priceListVersion', { version: contract.priceListVersion })}</p>
      <p>{t('contract.tax')}</p>
      <p>
        {document ? (
          <a href={`/documents/contracts/${encodeURIComponent(id)}`}>{t('profile.originalPdf')}</a>
        ) : (
          t('profile.documentUnavailable')
        )}
      </p>
      <form>
        <label>
          {t('contract.invoiceDate')}{' '}
          <input
            className="border p-1"
            name="invoiceDate"
            type="date"
            defaultValue={date.success ? date.data : todayIso()}
            required
          />
        </label>{' '}
        <button className="border p-1">{t('contract.calculate')}</button>
      </form>
      <p>
        {invoice?.ok
          ? t('contract.invoice', {
              rate: invoice.vatPercent,
              tax: formatEuro(invoice.vatCents, intlLocale[locale]),
              total: formatEuro(invoice.totalCents, intlLocale[locale]),
            })
          : t('contract.unavailable')}
      </p>
      <InvoiceList invoices={invoices} contractId={id} actor={contract.actor} locale={locale} />
    </div>
  );
}
