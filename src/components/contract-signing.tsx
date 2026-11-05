'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CoefficientTable, PriceList, VatRates } from '@/data/schemas';
import { contractSigningState } from '@/domain/contract-signing';
import { availableTerms, minDownPaymentCents } from '@/domain/pricing';
import { listPriceOn } from '@/domain/price-list';
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
  initialTermMonths = 36,
  initialDownPaymentCents,
}: {
  assetId: string;
  lists: PriceList[];
  table: CoefficientTable;
  today: string;
  locale: Locale;
  vat: VatRates;
  initialTermMonths?: number;
  initialDownPaymentCents?: number;
}) {
  const terms = availableTerms(table);
  const [termMonths, setTerm] = useState(initialTermMonths);
  const price = listPriceOn(lists, assetId, today);
  const [downText, setDown] = useState(
    String(initialDownPaymentCents ?? (price.ok ? minDownPaymentCents(table, price.priceCents) : 0))
  );
  const downPaymentCents = downText.trim() === '' ? NaN : Number(downText);
  const [actor, setActor] = useState('');
  const busy = false;
  const router = useRouter();
  const t = getT(locale);
  const { quote, tax, reason, canSign } = contractSigningState(
    lists,
    table,
    vat,
    { assetId, termMonths, downPaymentCents },
    today,
    actor,
    busy
  );
  const statusId = useId();
  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!canSign || !quote.ok) return;
        // Compatibility entry point: main rechecks the saved application and consent.
        // Signing stays on the approved Review and sign flow, never the old API shape.
        router.push(
          `/${locale}/items/${encodeURIComponent(assetId)}/sign?${new URLSearchParams({
            term: String(termMonths),
            down: String(downPaymentCents),
            start: today,
            quoted: today,
          })}`
        );
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
          {terms.map((term) => (
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
          value={downText}
          onChange={(e) => setDown(e.target.value)}
          required
        />
      </label>
      <label className="block">
        {t('contract.actor')}
        <input
          className="ml-2 border p-1"
          name="actor"
          required
          maxLength={100}
          value={actor}
          onChange={(e) => setActor(e.target.value)}
        />
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
      <p id={statusId} role="status" aria-live="polite">
        {reason ? t(`signing.${reason}`) : t('signing.ready')}
      </p>
      <button
        className="rounded bg-emerald-800 px-3 py-2 text-white disabled:opacity-50"
        disabled={!canSign}
        aria-describedby={statusId}
        aria-busy={busy}
      >
        {t('contract.sign')}
      </button>
    </form>
  );
}
