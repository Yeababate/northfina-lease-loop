import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ContractSigning } from '@/components/contract-signing';
import { loadCoefficientTable, loadVatRates } from '@/data/load';
import { isLocale } from '@/i18n/locales';
import { db } from '@/server/db';
import { loadPricingLists } from '@/server/price-lists';
import { rulesForAsset } from '@/server/discount-rules';
import { todayIso } from '@/server/today';
import { parseCatalogueQuery } from '@/domain/catalogue';
import { availableTerms, DEFAULT_TERM_MONTHS } from '@/domain/pricing';

export default async function LeasePage({
  params,
  searchParams,
}: PageProps<'/[locale]/lease/[id]'>) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  await connection();
  const asset = await db.asset.findUnique({ where: { id } });
  if (!asset || asset.status !== 'available') notFound();
  const [lists, table, vat] = await Promise.all([
    loadPricingLists(db),
    loadCoefficientTable(),
    loadVatRates(),
  ]);
  const today = todayIso();
  const query = await searchParams;
  const { termMonths } = parseCatalogueQuery(query, {
    today,
    terms: availableTerms(table),
    defaultTerm: DEFAULT_TERM_MONTHS,
  });
  const downText = typeof query.down === 'string' ? query.down : undefined;
  const downPaymentCents =
    downText === undefined ? undefined : /^\d{1,12}$/.test(downText) ? Number(downText) : -1;
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl">
        {asset.make} {asset.model}
      </h1>
      <ContractSigning
        assetId={id}
        discountRules={await rulesForAsset(db, id)}
        lists={lists}
        table={table}
        today={today}
        locale={locale}
        vat={vat}
        initialTermMonths={termMonths}
        initialDownPaymentCents={downPaymentCents}
      />
    </div>
  );
}
