'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CoefficientTable, PriceList, VatRates } from '@/data/schemas';
import { invoicePrice, priceContract } from '@/domain/pricing';
import { formatEuro } from '@/domain/money';
import { getT } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';

export function ContractSigning({
  assetId,
  lists,
  table,
  today,
  locale,
  vat,
}: {
  assetId: string;
  lists: PriceList[];
  table: CoefficientTable;
  today: string;
  locale: Locale;
  vat: VatRates;
}) {
  const [termMonths, setTerm] = useState(36);
  const [downPaymentCents, setDown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const router = useRouter();
  const t = getT(locale);
  const quote = Number.isSafeInteger(downPaymentCents)
    ? priceContract(lists, table, { assetId, termMonths, downPaymentCents }, today)
    : { ok: false as const };
  const tax = quote.ok ? invoicePrice(quote.price, vat, today) : null;
  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!quote.ok || busy) return;
        setBusy(true);
        setError(false);
        const form = new FormData(event.currentTarget);
        try {
          const response = await fetch('/api/contracts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              assetId,
              termMonths,
              downPaymentCents,
              actor: form.get('actor'),
              expectedMonthlyNetCents: quote.price.monthlyNetCents,
              expectedPriceListVersion: quote.price.priceListVersion,
            }),
          });
          const result = await response.json();
          if (!response.ok || !result.success) {
            setError(true);
            return;
          }
          router.push(`/${locale}/contracts/${result.data.id}`);
          router.refresh();
        } catch {
          setError(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>{t('contract.rule')}</p>
      <label className="block">
        {t('contract.term')}
        <select
          className="ml-2 border p-1"
          value={termMonths}
          onChange={(e) => setTerm(Number(e.target.value))}
        >
          {[12, 24, 36, 48].map((term) => (
            <option key={term} value={term}>
              {term}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        {t('contract.down')}
        <input
          className="ml-2 w-28 border p-1"
          type="number"
          min="0"
          step="1"
          value={downPaymentCents}
          onChange={(e) => setDown(Number(e.target.value))}
          required
        />
      </label>
      <label className="block">
        {t('contract.actor')}
        <input className="ml-2 border p-1" name="actor" required maxLength={100} />
      </label>
      <p>
        {quote.ok
          ? t('contract.monthly', {
              amount: formatEuro(quote.price.monthlyNetCents, intlLocale[locale]),
            })
          : t('contract.unavailable')}
      </p>
      {quote.ok && (
        <p>{t('contract.period', { start: quote.price.signedOn, end: quote.price.endOn })}</p>
      )}
      {tax?.ok && (
        <p>
          {t('contract.invoice', {
            rate: tax.vatPercent,
            tax: formatEuro(tax.vatCents, intlLocale[locale]),
            total: formatEuro(tax.totalCents, intlLocale[locale]),
          })}
        </p>
      )}
      <p>{t('contract.tax')}</p>
      <button
        className="rounded bg-emerald-800 px-3 py-2 text-white disabled:opacity-50"
        disabled={!quote.ok || busy}
      >
        {t('contract.sign')}
      </button>
      {error && <p role="alert">{t('contract.error')}</p>}
    </form>
  );
}
