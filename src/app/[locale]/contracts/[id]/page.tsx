import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { isoDateSchema } from '@/data/schemas';
import { loadVatRates } from '@/data/load';
import { invoicePrice } from '@/domain/pricing';
import { formatEuro } from '@/domain/money';
import { getT } from '@/i18n/get-t';
import { intlLocale, isLocale } from '@/i18n/locales';
import { db } from '@/server/db';
import { todayIso } from '@/server/today';

export default async function ContractPage({
  params,
  searchParams,
}: PageProps<'/[locale]/contracts/[id]'>) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  await connection();
  const contract = await db.contract.findUnique({ where: { id } });
  if (!contract) notFound();
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
      <p>{t('contract.period', { start: contract.signedOn, end: contract.endOn })}</p>
      <p>{t('asset.priceListVersion', { version: contract.priceListVersion })}</p>
      <p>{t('contract.tax')}</p>
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
    </div>
  );
}
