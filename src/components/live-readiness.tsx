'use client';

// The readiness badge on the item page (#52). It follows the term and down payment sliders,
// because they move the amount and the rent, and so which questions apply and whether the
// rent fits the user's income. The answer comes from the readiness API, which prices the
// item exactly as signing will; requests wait a moment so dragging a slider sends one call.
import { useEffect, useState } from 'react';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { ReadinessBadge, type ReadinessView } from './readiness-badge';

type LiveReadinessProps = {
  assetId: string;
  termMonths: number;
  downPaymentCents: number;
  locale: Locale;
};

const DEBOUNCE_MS = 250;

export function LiveReadiness({
  assetId,
  termMonths,
  downPaymentCents,
  locale,
}: LiveReadinessProps) {
  const t = getT(locale);
  // The last answer and the lease it was for, so an old badge is shown as "checking".
  const [result, setResult] = useState<{ for: string; readiness: ReadinessView | null } | null>(
    null
  );
  const wanted = `${termMonths}:${downPaymentCents}`;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const query = new URLSearchParams({
        term: String(termMonths),
        down: String(downPaymentCents),
      });
      try {
        const response = await fetch(
          `/api/assets/${encodeURIComponent(assetId)}/readiness?${query}`,
          {
            signal: controller.signal,
          }
        );
        const body = (await response.json()) as { success: boolean; data?: ReadinessView };
        setResult({ for: wanted, readiness: body.success && body.data ? body.data : null });
      } catch {
        if (!controller.signal.aborted) setResult({ for: wanted, readiness: null });
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [assetId, termMonths, downPaymentCents, wanted]);

  const checking = result === null || result.for !== wanted;
  return (
    <div aria-live="polite" aria-busy={checking} className="mt-4">
      {result?.readiness ? (
        <div className={checking ? 'opacity-60' : undefined}>
          <ReadinessBadge
            readiness={result.readiness}
            locale={locale}
            t={t}
            profileHref={`/${locale}/profile`}
          />
        </div>
      ) : checking ? (
        <p className="text-sm text-stone-600 dark:text-stone-400">{t('readiness.checking')}</p>
      ) : null}
    </div>
  );
}
