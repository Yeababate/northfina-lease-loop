'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { reportReasons } from '@/domain/moderation';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { secondaryButton } from './ui';

export function RatingReportForm({
  ratingId,
  revision,
  locale,
}: {
  ratingId: string;
  revision: number;
  locale: Locale;
}) {
  const t = getT(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'submitted' | 'error' | 'stale' | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/ratings/${encodeURIComponent(ratingId)}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: revision,
          reason: form.get('reason'),
          explanation: form.get('explanation'),
        }),
      });
      if (response.ok) {
        setStatus('submitted');
        router.refresh();
      } else setStatus(response.status === 409 ? 'stale' : 'error');
    } catch {
      setStatus('error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="mt-3 rounded-lg border border-stone-300 p-3">
      <summary className="cursor-pointer font-medium">{t('moderation.report')}</summary>
      <form onSubmit={submit} className="mt-3 grid gap-3">
        <p className="text-sm">{t('moderation.pendingNotice')}</p>
        <label>
          {t('moderation.reason')}
          <select name="reason" required className="ml-2 rounded border p-2">
            {reportReasons.map((reason) => (
              <option key={reason} value={reason}>
                {t(`moderation.reason.${reason}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('moderation.explanation')}
          <textarea
            name="explanation"
            maxLength={2000}
            className="mt-1 block w-full rounded border p-2"
          />
        </label>
        <button disabled={busy || status === 'submitted'} className={secondaryButton}>
          {t('moderation.submit')}
        </button>
        {status ? <p role="status">{t(`moderation.${status}`)}</p> : null}
      </form>
    </details>
  );
}
