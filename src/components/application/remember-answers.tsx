'use client';

// "Remember this answer" (#52). RememberToggle sits under one question in the application;
// RememberAnswers lists every answer that can be remembered, each with a toggle, and a
// "Remember all my answers" button, at the end of the application and on Review and sign.
// Which answers can be remembered, and in which order they are saved, is decided in
// src/domain/remembered-answers.ts.
import { useId } from 'react';
import type { Question } from '@/data/schemas';
import type { Answers, AnswerValue } from '@/domain/answer-check';
import {
  answersToRemember,
  canRemember,
  profileKeyFromAnswers,
  rememberState,
  savedAnswersOf,
  type RememberState,
} from '@/domain/remembered-answers';
import type { Translate } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { SignInLink } from '../sign-in-link';
import { secondaryButton } from '../ui';
import { answerText, questionText } from './answer-text';
import type { RememberedAnswers } from './use-remembered-answers';

type RememberToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** How the profile compares with the answer currently on screen. */
  state: RememberState;
  /** The profile's answer in words, when it differs. */
  savedText: string | null;
  t: Translate;
};

/** The checkbox under one question. The text under it says what will happen on Continue. */
export function RememberToggle({ checked, onChange, state, savedText, t }: RememberToggleProps) {
  const id = useId();
  const note =
    state === 'saved'
      ? checked
        ? t('remember.inProfile')
        : t('remember.thisApplicationOnly')
      : state === 'different'
        ? checked
          ? t('remember.willReplace', { answer: savedText ?? '' })
          : t('remember.profileKeeps', { answer: savedText ?? '' })
        : checked
          ? t('remember.willSave')
          : t('remember.thisApplicationOnly');
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={`${id}-note`}
        className="mt-1 size-4 accent-blue-600"
      />
      <div>
        <label htmlFor={id} className="font-medium">
          {t('remember.toggle')}
        </label>
        <p id={`${id}-note`} className="text-sm text-stone-600 dark:text-stone-400">
          {note}
        </p>
      </div>
    </div>
  );
}

type RememberAnswersProps = {
  questions: readonly Question[];
  /** The application's answers that still count. */
  answers: Answers;
  store: RememberedAnswers;
  locale: Locale;
  t: Translate;
};

const stateMark: Record<RememberState, string> = {
  saved: '✓',
  different: '≠',
  unsaved: '–',
  not_rememberable: '',
};

/** Every rememberable answer with a toggle, and "Remember all my answers". */
export function RememberAnswers({ questions, answers, store, locale, t }: RememberAnswersProps) {
  const headingId = useId();
  if (!store.signedIn) {
    return (
      <p className="text-sm text-stone-700 dark:text-stone-300">
        {t('remember.signedOut')} <SignInLink locale={locale} label={t('nav.signIn')} />
      </p>
    );
  }
  const key = profileKeyFromAnswers(answers);
  if (key === null) return null;
  const saved = savedAnswersOf(store.sets, key);
  const rows = questions.filter(
    (question) => answers[question.id] !== undefined && canRemember(question.id, key.customerType)
  );
  if (rows.length === 0) return null;
  const toSave = answersToRemember(questions, answers, key, saved);

  function toggle(questionId: string, value: AnswerValue, on: boolean) {
    if (key === null) return;
    void (on ? store.save(key.key, [[questionId, value]]) : store.forget(key.key, questionId));
  }

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={store.busy}
      className="rounded-2xl border border-stone-300 p-5 dark:border-stone-700"
    >
      <h2 id={headingId} className="text-lg font-semibold">
        {t('remember.title')}
      </h2>
      <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">{t('remember.intro')}</p>
      <ul className="mt-4 space-y-3">
        {rows.map((question) => {
          const value = answers[question.id] as AnswerValue;
          const state = rememberState(question.id, value, key, saved);
          const savedValue = saved[question.id];
          const rowId = `${headingId}-${question.id}`;
          return (
            <li key={question.id} className="flex items-start gap-3">
              <input
                id={rowId}
                type="checkbox"
                checked={state === 'saved'}
                disabled={store.busy}
                onChange={(event) => toggle(question.id, value, event.target.checked)}
                aria-describedby={`${rowId}-state`}
                className="mt-1 size-4 accent-blue-600"
              />
              <div className="min-w-0">
                <label htmlFor={rowId} className="block">
                  <span className="text-sm text-stone-600 dark:text-stone-400">
                    {questionText(question, locale)}
                  </span>
                  <span className="block font-semibold break-words">
                    {answerText(question, value, locale, t)}
                  </span>
                </label>
                <p id={`${rowId}-state`} className="text-sm text-stone-600 dark:text-stone-400">
                  <span aria-hidden="true">{stateMark[state]} </span>
                  {state === 'saved'
                    ? t('remember.state.saved')
                    : state === 'different' && savedValue !== undefined
                      ? t('remember.state.different', {
                          answer: answerText(question, savedValue, locale, t),
                        })
                      : t('remember.state.unsaved')}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => void store.save(key.key, toSave)}
        disabled={store.busy || toSave.length === 0}
        className={`${secondaryButton} mt-4 w-full disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {t('remember.all')}
      </button>
      <p role="status" className="mt-2 text-sm">
        {store.busy
          ? t('remember.saving')
          : store.failed
            ? t('remember.failed')
            : toSave.length === 0
              ? t('remember.allSaved')
              : ''}
      </p>
    </section>
  );
}
