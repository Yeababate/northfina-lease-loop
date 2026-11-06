'use client';

// "Rate this lease" on the contract page, once the lease has been completed: one to five
// stars and an optional comment about the provider. The same form edits an earlier rating;
// the server keeps every revision (src/server/ratings.ts).
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { primaryButton, secondaryButton } from '../ui';

export type OwnRatingView = { id: string; stars: number; comment: string; currentRevision: number };

type RateLeaseProps = { contractId: string; locale: Locale; rating: OwnRatingView | null };

const STARS = [1, 2, 3, 4, 5] as const;
export const RATING_COMMENT_MAX = 2000;

export function RateLease({ contractId, locale, rating }: RateLeaseProps) {
  const t = getT(locale);
  const router = useRouter();
  const commentId = useId();
  const [editing, setEditing] = useState(rating === null);
  const [stars, setStars] = useState(rating?.stars ?? 0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'stars' | 'stale' | 'error' | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stars < 1) {
      setProblem('stars');
      return;
    }
    const comment = String(new FormData(event.currentTarget).get('comment') ?? '');
    setBusy(true);
    setProblem(null);
    try {
      const response = rating
        ? await fetch(`/api/ratings/${encodeURIComponent(rating.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stars, comment, expectedRevision: rating.currentRevision }),
          })
        : await fetch(`/api/contracts/${encodeURIComponent(contractId)}/ratings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stars, comment }),
          });
      if (response.ok) {
        setEditing(false);
        router.refresh();
      } else setProblem(response.status === 409 ? 'stale' : 'error');
    } catch {
      setProblem('error');
    } finally {
      setBusy(false);
    }
  }

  if (rating && !editing) {
    return (
      <div className="space-y-2">
        <p
          className="text-xl text-amber-500"
          aria-label={t('rating.starsOf', { stars: rating.stars })}
        >
          {'★'.repeat(rating.stars)}
          <span className="text-stone-300 dark:text-stone-600">{'★'.repeat(5 - rating.stars)}</span>
        </p>
        {rating.comment ? <p className="whitespace-pre-line">{rating.comment}</p> : null}
        <button type="button" className={secondaryButton} onClick={() => setEditing(true)}>
          {t('rating.edit')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <fieldset>
        <legend className="font-semibold">{t('rating.question')}</legend>
        <div className="mt-2 flex gap-1">
          {STARS.map((value) => (
            <label key={value} className="cursor-pointer">
              <input
                type="radio"
                name="stars"
                value={value}
                checked={stars === value}
                onChange={() => setStars(value)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={
                  'block rounded px-0.5 text-3xl leading-none peer-focus-visible:ring-2 peer-focus-visible:ring-blue-600 ' +
                  (value <= stars ? 'text-amber-500' : 'text-stone-300 dark:text-stone-600')
                }
              >
                ★
              </span>
              <span className="sr-only">{t('rating.starsOf', { stars: value })}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={commentId} className="font-semibold">
          {t('rating.comment')}
        </label>
        <textarea
          id={commentId}
          name="comment"
          rows={3}
          maxLength={RATING_COMMENT_MAX}
          defaultValue={rating?.comment ?? ''}
          className="mt-1 w-full rounded-lg border border-stone-400 bg-white px-3 py-2 dark:border-stone-600 dark:bg-stone-900"
        />
      </div>
      {problem ? (
        <p role="alert" className="font-medium text-red-700 dark:text-red-400">
          {t(`rating.problem.${problem}`)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className={primaryButton}>
          {rating ? t('rating.saveEdit') : t('rating.submit')}
        </button>
        {rating ? (
          <button type="button" className={secondaryButton} onClick={() => setEditing(false)}>
            {t('rating.cancel')}
          </button>
        ) : null}
      </div>
    </form>
  );
}
