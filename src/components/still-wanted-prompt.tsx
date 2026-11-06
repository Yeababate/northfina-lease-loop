'use client';

// "Do you still want this?" on a waiting-list request whose needed-by date has passed (#75).
// Yes: pick a new needed-by date (the server checks it is after today). No: leave the list.
// Either way the page refreshes to show the request as it now stands.
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { addCalendarDays } from '@/domain/local-time';
import { formatIsoDate } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { primaryButton, secondaryButton } from './ui';

type Problem = 'not_in_future' | 'not_a_date' | 'closed' | 'error';

type StillWantedPromptProps = {
  locale: Locale;
  entryId: string;
  neededBy: string;
  /** The last day to answer. */
  replyBy: string;
  today: string;
};

export function StillWantedPrompt({
  locale,
  entryId,
  neededBy,
  replyBy,
  today,
}: StillWantedPromptProps) {
  const t = getT(locale);
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const tomorrow = addCalendarDays(today, 1);

  async function send(body: unknown) {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(
        `/api/waiting-list/${encodeURIComponent(entryId)}/still-wanted`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      if (response.ok) {
        router.refresh();
        return;
      }
      if (response.status === 409) {
        setProblem('closed');
        router.refresh();
        return;
      }
      const json = (await response.json().catch(() => null)) as {
        error?: { details?: unknown };
      } | null;
      const details = Array.isArray(json?.error?.details) ? json.error.details : [];
      setProblem(
        details.includes('not_in_future')
          ? 'not_in_future'
          : details.includes('not_a_date')
            ? 'not_a_date'
            : 'error'
      );
    } catch {
      setProblem('error');
    } finally {
      setBusy(false);
    }
  }

  function keep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const neededByInput = new FormData(event.currentTarget).get('neededBy');
    if (typeof neededByInput !== 'string' || neededByInput === '') {
      setProblem('not_a_date');
      return;
    }
    void send({ answer: 'yes', neededBy: neededByInput });
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-xl border border-orange-400 bg-orange-50 px-5 py-4 text-sm dark:border-orange-700 dark:bg-orange-950"
    >
      <h2 id={`${id}-title`} className="font-semibold">
        {t('waitlist.stillWanted.title')}
      </h2>
      <p className="mt-1">
        {t('waitlist.stillWanted.body', {
          date: formatIsoDate(neededBy, locale),
          replyBy: formatIsoDate(replyBy, locale),
        })}
      </p>
      <form onSubmit={keep} noValidate className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col">
          {t('waitlist.stillWanted.newDate')}
          <input
            name="neededBy"
            type="date"
            min={tomorrow}
            defaultValue={addCalendarDays(today, 30)}
            required
            aria-describedby={problem ? `${id}-problem` : undefined}
            className="mt-1 rounded-lg border border-stone-400 bg-white px-3 py-2 dark:border-stone-600 dark:bg-stone-900"
          />
        </label>
        <button type="submit" disabled={busy} className={primaryButton}>
          {t('waitlist.stillWanted.yes')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void send({ answer: 'no' })}
          className={secondaryButton}
        >
          {t('waitlist.stillWanted.no')}
        </button>
      </form>
      {problem ? (
        <p id={`${id}-problem`} role="alert" className="mt-2 text-red-700 dark:text-red-400">
          {t(`waitlist.stillWanted.problem.${problem}`)}
        </p>
      ) : null}
    </section>
  );
}
