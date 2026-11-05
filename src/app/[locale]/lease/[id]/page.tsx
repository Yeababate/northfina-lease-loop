import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ContractSigning } from '@/components/contract-signing';
import { loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
import { isLocale } from '@/i18n/locales';
import { db } from '@/server/db';
import { todayIso } from '@/server/today';

export default async function LeasePage({ params }: PageProps<'/[locale]/lease/[id]'>) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  await connection();
  const asset = await db.asset.findUnique({ where: { id } });
  if (!asset || asset.status !== 'available') notFound();
  const [lists, table, vat] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
  ]);
  const today = todayIso();
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl">
        {asset.make} {asset.model}
      </h1>
      <ContractSigning
        assetId={id}
        lists={lists}
        table={table}
        today={today}
        locale={locale}
        vat={vat}
      />
    </div>
  );
}
