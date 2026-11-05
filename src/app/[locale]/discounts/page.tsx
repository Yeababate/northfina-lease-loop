import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { cookies } from 'next/headers';
import { listProviders, PROVIDER_COOKIE } from '@/server/providers';
import { DiscountManager } from '@/components/discount-manager';
import { getT } from '@/i18n/get-t';
import { isLocale } from '@/i18n/locales';
import { db } from '@/server/db';
import { dealerDiscountView } from '@/server/dealer-discount';
import { loadCoefficientTable } from '@/data/load';

export default async function DiscountsPage({ params }: PageProps<'/[locale]/discounts'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await connection();
  const providers = await listProviders(db);
  const selectedId = (await cookies()).get(PROVIDER_COOKIE)?.value;
  const providerId = providers.find((provider) => provider.id === selectedId)?.id ?? '';
  const table = await loadCoefficientTable();
  const view = providerId ? await dealerDiscountView(db, providerId, table) : null;
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <h1 className="text-2xl font-semibold">{getT(locale)('discount.manage')}</h1>
      <DiscountManager
        key={providerId}
        providers={providers}
        locale={locale}
        initialProviderId={providerId}
        initialView={view}
      />
    </div>
  );
}
