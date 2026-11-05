'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { ModerationAction } from '@/domain/moderation';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { secondaryButton } from './ui';

export function ModerationDecisionForm({
  reportId,
  reportVersion,
  ratingRevision,
  moderationVersion,
  pending,
  hidden,
  locale,
}: {
  reportId: string;
  reportVersion: number;
  ratingRevision: number;
  moderationVersion: number;
  pending: boolean;
  hidden: boolean;
  locale: Locale;
}) {
  const t = getT(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'saved' | 'stale' | 'error' | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/moderation/reports/${encodeURIComponent(reportId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: form.get('action'),
          rationale: form.get('rationale'),
          expectedReportVersion: reportVersion,
          expectedRatingRevision: ratingRevision,
          expectedModerationVersion: moderationVersion,
        }),
      });
      if (response.ok) {
        setStatus('saved');
        router.refresh();
      } else setStatus(response.status === 409 ? 'stale' : 'error');
    } catch {
      setStatus('error');
    } finally {
      setBusy(false);
    }
  }
  const actions: ModerationAction[] = [
    ...(pending ? ['keep' as const, 'hide' as const] : []),
    ...(hidden ? ['restore' as const] : []),
  ];
  if (!actions.length) return null;
  return (
    <form onSubmit={submit} className="mt-4 grid gap-3">
      <label>
        {t('moderation.rationale')}
        <textarea
          name="rationale"
          required
          maxLength={2000}
          className="mt-1 block w-full rounded border p-2"
        />
      </label>
      <label>
        <span className="sr-only">{t('moderation.save')}</span>
        <select name="action" className="rounded border p-2">
          {actions.map((action) => (
            <option key={action} value={action}>
              {t(`moderation.${action}`)}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={busy || status === 'stale' || status === 'saved'}
        className={secondaryButton}
      >
        {t('moderation.save')}
      </button>
      {status ? <p role="status">{t(`moderation.${status}`)}</p> : null}
      {status === 'stale' ? (
        <button
          type="button"
          onClick={() => {
            router.refresh();
            setStatus(null);
          }}
          className={secondaryButton}
        >
          {t('moderation.refresh')}
        </button>
      ) : null}
    </form>
  );
}
