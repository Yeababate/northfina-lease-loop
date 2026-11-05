'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';

export function GenerateInvoices({
  contractId,
  actor,
  locale,
}: {
  contractId: string;
  actor: string;
  locale: Locale;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const router = useRouter();
  const t = getT(locale);
  return (
    <div>
      <button
        className="rounded bg-emerald-800 px-3 py-2 text-white disabled:opacity-50"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            const response = await fetch(
              `/api/contracts/${encodeURIComponent(contractId)}/invoices`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actor }),
              }
            );
            const result = await response.json();
            if (!response.ok || !result.success) setError(true);
            else router.refresh();
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t(busy ? 'invoices.generating' : 'invoices.generate')}
      </button>
      {error && <p role="alert">{t('invoices.error')}</p>}
    </div>
  );
}
