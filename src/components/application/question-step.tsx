'use client';

// One question on screen: the right input for its type, "Why we ask", Back and Continue.
// It only collects the value; the wizard checks it with checkAnswer and moves on.
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Question } from '@/data/schemas';
import type { AnswerProblem, AnswerValue } from '@/domain/answer-check';
import { parseEuroInput } from '@/domain/money';
import type { Translate } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { InfoBox, primaryButton, secondaryButton } from '../ui';
import { optionLabel, questionText, whyWeAsk } from './answer-text';

type QuestionStepProps = {
  question: Question;
  initialValue: AnswerValue | undefined;
  problem: AnswerProblem | null;
  locale: Locale;
  t: Translate;
  /** Move keyboard focus to the question when it appears (not on the first page load). */
  focusOnMount: boolean;
  /** Back to the previous question, or a link out when this is the first question. */
  back: { onClick: () => void } | { href: string };
  onSubmit: (value: AnswerValue | undefined) => void;
};

const fieldClass =
  'w-full max-w-sm rounded-lg border border-stone-400 bg-white px-3 py-2.5 text-lg text-stone-900 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100';

export function QuestionStep(props: QuestionStepProps) {
  const { question, problem, locale, t } = props;
  const [text, setText] = useState(() => toInputText(props.initialValue));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputId = useId();
  const problemId = useId();
  const hintId = useId();

  useEffect(() => {
    if (props.focusOnMount) headingRef.current?.focus();
  }, [props.focusOnMount]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onSubmit(toAnswer(question, text));
  }

  const hint =
    question.type === 'money'
      ? t('apply.moneyHint')
      : question.type === 'list'
        ? t('apply.listHint')
        : null; // validation.hint in the data pack is English only, so problems explain instead
  const describedBy = [hint ? hintId : null, problem ? problemId : null].filter(Boolean).join(' ');

  return (
    <form onSubmit={submit} noValidate className="mt-6">
      <h1
        ref={headingRef}
        tabIndex={-1}
        id={`${inputId}-label`}
        className="text-3xl font-semibold tracking-tight outline-none"
      >
        {question.type === 'choice' ? (
          questionText(question, locale)
        ) : (
          <label htmlFor={inputId}>{questionText(question, locale)}</label>
        )}
      </h1>

      <div className="mt-5">
        {question.type === 'choice' ? (
          <fieldset
            aria-labelledby={`${inputId}-label`}
            aria-describedby={describedBy || undefined}
          >
            <div className="grid max-w-md gap-2">
              {(question.options ?? []).map((option) => (
                <label
                  key={option}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-stone-300 px-4 py-3 has-checked:border-blue-600 has-checked:bg-blue-50 dark:border-stone-700 dark:has-checked:border-blue-400 dark:has-checked:bg-blue-950/60"
                >
                  <input
                    type="radio"
                    name={question.id}
                    value={option}
                    checked={text === option}
                    onChange={() => setText(option)}
                    className="size-4 accent-blue-600"
                  />
                  {optionLabel(option, t)}
                </label>
              ))}
            </div>
          </fieldset>
        ) : question.type === 'list' ? (
          <textarea
            id={inputId}
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-describedby={describedBy || undefined}
            aria-invalid={problem ? true : undefined}
            className={fieldClass}
          />
        ) : (
          <input
            id={inputId}
            type={inputType(question)}
            inputMode={question.type === 'money' ? 'decimal' : undefined}
            autoComplete={autoComplete(question)}
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-describedby={describedBy || undefined}
            aria-invalid={problem ? true : undefined}
            className={fieldClass}
          />
        )}
        {hint ? (
          <p id={hintId} className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            {hint}
          </p>
        ) : null}
        {problem ? (
          <p
            id={problemId}
            role="alert"
            className="mt-2 font-medium text-red-700 dark:text-red-400"
          >
            {t(`problem.${problem}`)}
          </p>
        ) : null}
      </div>

      <div className="mt-6">
        <InfoBox title={t('apply.whyWeAsk')}>{whyWeAsk(question, locale)}</InfoBox>
      </div>

      <div className="mt-6 flex gap-3">
        {'href' in props.back ? (
          <Link href={props.back.href} className={secondaryButton}>
            {t('apply.previous')}
          </Link>
        ) : (
          <button type="button" onClick={props.back.onClick} className={secondaryButton}>
            {t('apply.previous')}
          </button>
        )}
        <button type="submit" className={primaryButton}>
          {t('apply.continue')}
        </button>
      </div>
    </form>
  );
}

function inputType(question: Question): string {
  if (question.type === 'email') return 'email';
  if (question.type === 'date') return 'date';
  return 'text';
}

function autoComplete(question: Question): string | undefined {
  if (question.id === 'q_full_name') return 'name';
  if (question.id === 'q_birth_date') return 'bday';
  if (question.id === 'q_email') return 'email';
  return undefined;
}

/** A stored answer back into the text the input shows. */
function toInputText(value: AnswerValue | undefined): string {
  if (value === undefined) return '';
  if (Array.isArray(value)) return value.join('\n');
  if (typeof value === 'number') {
    const euros = Math.floor(value / 100);
    const cents = value % 100;
    return cents === 0 ? String(euros) : `${euros}.${String(cents).padStart(2, '0')}`;
  }
  return value as string;
}

/** What the customer typed, as the answer type the question expects. */
function toAnswer(question: Question, text: string): AnswerValue | undefined {
  if (question.type === 'list') {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  }
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (question.type === 'money') {
    const parsed = parseEuroInput(trimmed);
    // NaN is not whole cents, so checkAnswer reports it as bad_money.
    return parsed.ok ? parsed.cents : Number.NaN;
  }
  return trimmed;
}
