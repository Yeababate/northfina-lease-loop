'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LeaseQuote } from '@/domain/pricing';
import type { PriceSource } from '@/domain/price-list';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { primaryButton } from './ui';

export function StartApplicationButton(props: {
  locale: Locale;
  assetId: string;
  applyPath: string;
  quotedOn: string;
  startOn: string;
  priceListVersion: number;
  priceSource: PriceSource;
  coefficientId: string;
  coefficientVersion: number;
  quote: LeaseQuote;
}) {
  const { quote, locale } = props;
  const t = getT(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'changed' | 'login' | 'generic' | null>(null);
  // Keep one key while this displayed offer is retried; any offer change gets a new key.
  const requestKey = useRef<{ offer: string; key: string } | null>(null);

  async function startApplication() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const offerKey = JSON.stringify({
        assetId: props.assetId,
        quote,
        startOn: props.startOn,
        quotedOn: props.quotedOn,
        priceListVersion: props.priceListVersion,
        priceSource: props.priceSource,
        coefficientId: props.coefficientId,
        coefficientVersion: props.coefficientVersion,
      });
      if (requestKey.current?.offer !== offerKey) {
        requestKey.current = { offer: offerKey, key: crypto.randomUUID() };
      }
      const response = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestKey: requestKey.current.key,
          assetId: props.assetId,
          termMonths: quote.termMonths,
          downPaymentCents: quote.downPaymentCents,
          startOn: props.startOn,
          quotedOn: props.quotedOn,
          expected: {
            monthlyNetCents: quote.monthlyNetCents,
            originalMonthlyNetCents: quote.originalMonthlyNetCents,
            monthlyDiscountCents: quote.monthlyDiscountCents,
            discountBps: quote.discountBps,
            buyoutNetCents: quote.buyoutCents,
            monthlyGrossCents: quote.monthlyGrossCents,
            priceListVersion: props.priceListVersion,
            priceSource: props.priceSource,
            listPriceCents: quote.listPriceCents,
            discountRuleId: quote.discountRuleId,
            discountRuleRevision: quote.discountRuleRevision,
            coefficientVersion: props.coefficientVersion,
            coefficientId: props.coefficientId,
            band: quote.band.band,
            factor: quote.factor,
          },
        }),
      });
      const result: {
        success: boolean;
        data?: { id: string };
        error?: { code: string };
      } = await response.json();
      if (!result.success || !result.data) {
        setError(
          result.error?.code === 'PRICE_CHANGED'
            ? 'changed'
            : result.error?.code === 'LOGIN_REQUIRED'
              ? 'login'
              : 'generic'
        );
        return;
      }
      const params = new URLSearchParams({
        term: String(quote.termMonths),
        down: String(quote.downPaymentCents),
        start: props.startOn,
        quoteId: result.data.id,
      });
      router.push(`${props.applyPath}?${params}`);
    } catch {
      setError('generic');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={startApplication}
        disabled={busy}
        className={`${primaryButton} mt-4 w-full disabled:cursor-wait disabled:opacity-60`}
      >
        {busy ? t('quote.saving') : t('item.apply')}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {error === 'changed'
            ? t('quote.changed')
            : error === 'login'
              ? t('quote.signIn')
              : t('quote.error')}
        </p>
      ) : null}
    </div>
  );
}
