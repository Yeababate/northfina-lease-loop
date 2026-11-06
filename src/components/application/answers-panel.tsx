'use client';

// "Your answers so far": every answer that still counts, each with a Change button.
// It is a collapsible side bar: open by default from the lg breakpoint, where it sits beside
// the question, and collapsed below it, where it sits under the question. Once the customer
// opens or closes it, that choice wins over the screen width.
import { useId, useState, useSyncExternalStore } from 'react';
import type { Question } from '@/data/schemas';
import type { Answers } from '@/domain/answer-check';
import type { Translate } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { answerText, questionText } from './answer-text';

type AnswersPanelProps = {
  questions: readonly Question[];
  /** Answered question ids, in the order they were asked. */
  answered: readonly string[];
  answers: Answers;
  /** Answers the user's profile has (#52): pre-filled from it, or saved to it just now. */
  tags?: Readonly<Record<string, AnswerTag>>;
  locale: Locale;
  t: Translate;
  onChange: (questionId: string) => void;
};

export type AnswerTag = 'profile' | 'saved';

// Tailwind's lg breakpoint (64rem).
const WIDE_QUERY = '(min-width: 64rem)';

function subscribeWide(onChange: () => void) {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** True from the lg breakpoint. False on the server, so the first render matches. */
function useWideScreen(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false
  );
}

export function AnswersPanel(props: AnswersPanelProps) {
  const { questions, answered, answers, locale, t } = props;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const contentId = useId();
  const wide = useWideScreen();
  // null: follow the screen width. CSS does that too, so nothing jumps before hydration.
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? wide;
  const contentClass = choice === null ? 'hidden lg:block' : choice ? 'block' : 'hidden';

  return (
    <section
      aria-labelledby="answers-so-far"
      className="rounded-2xl border border-stone-300 p-5 dark:border-stone-700"
    >
      <h2 className="text-lg font-semibold">
        <button
          type="button"
          id="answers-so-far"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setChoice(!open)}
          className="flex w-full items-center justify-between gap-4 text-left"
        >
          <span>
            {t('apply.answersSoFar')}
            {answered.length > 0 ? (
              <span className="ml-2 text-sm font-normal text-stone-600 dark:text-stone-400">
                ({answered.length})
              </span>
            ) : null}
          </span>
          <span
            aria-hidden="true"
            className={`text-stone-600 transition-transform dark:text-stone-400 ${open ? 'rotate-180' : ''}`}
          >
            ▾
          </span>
        </button>
      </h2>
      <div id={contentId} className={contentClass}>
        {answered.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            {t('apply.noAnswersYet')}
          </p>
        ) : (
          <dl className="mt-3 space-y-3">
            {answered.map((id) => {
              const question = byId.get(id);
              const value = answers[id];
              if (!question || value === undefined) return null;
              const text = questionText(question, locale);
              return (
                <div key={id} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <dt className="text-sm text-stone-600 dark:text-stone-400">{text}</dt>
                    <dd className="font-semibold break-words">
                      {answerText(question, value, locale, t)}
                    </dd>
                    {props.tags?.[id] ? (
                      <dd className="text-xs text-stone-600 dark:text-stone-400">
                        <span aria-hidden="true">✓ </span>
                        {t(
                          props.tags[id] === 'profile'
                            ? 'remember.fromProfile'
                            : 'remember.state.saved'
                        )}
                      </dd>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => props.onChange(id)}
                    aria-label={t('apply.changeLabel', { question: text })}
                    className="shrink-0 text-sm text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-300"
                  >
                    {t('apply.change')}
                  </button>
                </div>
              );
            })}
          </dl>
        )}
      </div>
    </section>
  );
}
