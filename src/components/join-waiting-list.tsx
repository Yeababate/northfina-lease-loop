'use client';

// "Want one like this? Join the waiting list" on an item that cannot be leased right now.
// The request joins the same list the second-life matching ranks; the customer sees it under
// My leases. Folded to one line until opened, so it never crowds the page.
import Link from 'next/link';
import { useId, useState, type FormEvent } from 'react';
import type { AssetCategory, AssetCondition } from '@/data/schemas';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { primaryButton, secondaryButton, textLink } from './ui';

const CONDITIONS: AssetCondition[] = ['fair', 'good', 'like_new', 'new'];

type JoinWaitingListProps = {
  locale: Locale;
  category: AssetCategory;
  terms: readonly number[];
  today: string;
  /** A month from today, as a sensible default. */
  defaultNeededBy: string;
  /** Null when signed in; otherwise where "Sign in" goes. */
  signInHref: string | null;
};

type Problem = 'budget' | 'term' | 'needed_by' | 'error';

export function JoinWaitingList(props: JoinWaitingListProps) {
  const { locale, category, terms } = props;
  const t = getT(locale);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const kind = t(`categoryOne.${category}`);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const euros = Number(form.get('budget'));
    setBusy(true);
    setProblems([]);
    try {
      const response = await fetch('/api/waiting-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          // Whole euros typed, whole cents sent.
          maxMonthlyNetRentCents: Number.isFinite(euros) ? Math.round(euros * 100) : 0,
          minCondition: form.get('condition'),
          preferredTermMonths: Number(form.get('term')),
          neededBy: form.get('neededBy'),
        }),
      });
      if (response.ok) {
        setDone(true);
        return;
      }
      const body = (await response.json().catch(() => null)) as {
        error?: { details?: unknown };
      } | null;
      const details = Array.isArray(body?.error?.details) ? body.error.details : [];
      setProblems(
        details.filter((d): d is Problem => d === 'budget' || d === 'term' || d === 'needed_by')
          .length > 0
          ? (details as Problem[])
          : ['error']
      );
    } catch {
      setProblems(['error']);
    } finally {
      setBusy(false);
    }
  }

  const box = 'rounded-xl border border-stone-300 px-5 py-4 text-sm dark:border-stone-700';
  const field =
    'mt-1 w-full rounded-lg border border-stone-400 bg-white px-3 py-2 dark:border-stone-600 dark:bg-stone-900';

  if (done)
    return (
      <section className={box} role="status">
        <p className="font-semibold">{t('waitlist.doneTitle')}</p>
        <p className="mt-1">{t('waitlist.doneBody', { kind })}</p>
        <Link href={`/${locale}/leases#waiting-list`} className={`${textLink} mt-2 inline-block`}>
          {t('waitlist.seeRequests')}
        </Link>
      </section>
    );

  return (
    <section aria-labelledby={`${id}-title`} className={box}>
      <h2 id={`${id}-title`} className="font-semibold">
        {t('waitlist.title', { kind })}
      </h2>
      <p className="mt-1 text-stone-700 dark:text-stone-300">{t('waitlist.intro')}</p>
      {props.signInHref ? (
        <Link href={props.signInHref} className={`${secondaryButton} mt-3`}>
          {t('waitlist.signIn')}
        </Link>
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className={`${secondaryButton} mt-3`}>
          {t('waitlist.open')}
        </button>
      ) : (
        <form onSubmit={submit} noValidate className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col">
            {t('waitlist.budget')}
            <input
              name="budget"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              required
              className={field}
            />
            {problems.includes('budget') ? (
              <span className="mt-1 text-red-700 dark:text-red-400">
                {t('waitlist.problem.budget')}
              </span>
            ) : null}
          </label>
          <label className="flex flex-col">
            {t('waitlist.condition')}
            <select name="condition" defaultValue="good" className={field}>
              {CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {t(`condition.${condition}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            {t('waitlist.term')}
            <select name="term" defaultValue={terms.includes(24) ? 24 : terms[0]} className={field}>
              {terms.map((months) => (
                <option key={months} value={months}>
                  {t('term.months', { months })}
                </option>
              ))}
            </select>
            {problems.includes('term') ? (
              <span className="mt-1 text-red-700 dark:text-red-400">
                {t('waitlist.problem.term')}
              </span>
            ) : null}
          </label>
          <label className="flex flex-col">
            {t('waitlist.neededBy')}
            <input
              name="neededBy"
              type="date"
              min={props.today}
              defaultValue={props.defaultNeededBy}
              required
              className={field}
            />
            {problems.includes('needed_by') ? (
              <span className="mt-1 text-red-700 dark:text-red-400">
                {t('waitlist.problem.needed_by')}
              </span>
            ) : null}
          </label>
          {problems.includes('error') ? (
            <p role="alert" className="text-red-700 sm:col-span-2 dark:text-red-400">
              {t('waitlist.problem.error')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3 sm:col-span-2">
            <button type="submit" disabled={busy} className={primaryButton}>
              {t('waitlist.submit')}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={secondaryButton}>
              {t('waitlist.cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
