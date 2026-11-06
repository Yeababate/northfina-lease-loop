'use client';

// One question on screen: the right input for its type, "Why we ask", Back and Continue.
// It only collects the value; the wizard checks it with checkAnswer and moves on.
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Question } from '@/data/schemas';
import type { AnswerProblem, AnswerValue } from '@/domain/answer-check';
import type { Translate } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { InfoBox, primaryButton, secondaryButton } from '../ui';
import { AnswerField, answerHint, toAnswer, toInputText } from './answer-field';
import { questionText, whyWeAsk } from './answer-text';

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
  /** The "Remember this answer" control (#52), under the answer. */
  remember?: ReactNode;
};

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

  const hint = answerHint(question, t);
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
        <AnswerField
          question={question}
          inputId={inputId}
          labelledBy={`${inputId}-label`}
          text={text}
          onText={setText}
          describedBy={describedBy}
          invalid={problem !== null}
          t={t}
        />
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

      {props.remember ? <div className="mt-5">{props.remember}</div> : null}

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
