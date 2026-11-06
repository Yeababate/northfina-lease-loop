'use client';

// One question in Profile → My answers (#52): when it is asked, why we ask, the saved
// answer, and Edit / Forget. Editing uses the same field and the same check (checkAnswer)
// as the application, so the profile can never hold an answer the application would refuse.
import { useEffect, useId, useRef, useState } from 'react';
import type { Question } from '@/data/schemas';
import { checkAnswer, type AnswerProblem, type AnswerValue } from '@/domain/answer-check';
import type { Translate } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { AnswerField, answerHint, toAnswer, toInputText } from '../application/answer-field';
import { answerText, questionText, whyWeAsk } from '../application/answer-text';
import { primaryButton, secondaryButton } from '../ui';

type ProfileQuestionProps = {
  question: Question;
  saved: AnswerValue | undefined;
  /** "Only asked for leases from €10,000", in words. */
  hints: string[];
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onClose: () => void;
  onSave: (value: AnswerValue) => Promise<boolean>;
  onForget: () => void;
  locale: Locale;
  t: Translate;
};

const smallButton = 'px-3 py-1.5 text-sm';

export function ProfileQuestion(props: ProfileQuestionProps) {
  const { question, saved, editing, busy, locale, t } = props;
  const headingId = useId();
  const inputId = useId();
  const text = questionText(question, locale);

  return (
    <li className="rounded-2xl border border-stone-300 p-5 dark:border-stone-700">
      <h3 id={headingId} className="font-semibold">
        {editing && question.type !== 'choice' ? <label htmlFor={inputId}>{text}</label> : text}
      </h3>
      {props.hints.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-2">
          {props.hints.map((hint) => (
            <li
              key={hint}
              className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-800 dark:bg-stone-800 dark:text-stone-200"
            >
              {hint}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">{t('askWhen.always')}</p>
      )}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-stone-700 underline underline-offset-2 dark:text-stone-300">
          {t('apply.whyWeAsk')}
        </summary>
        <p className="mt-1 text-stone-700 dark:text-stone-300">{whyWeAsk(question, locale)}</p>
      </details>

      {editing ? (
        <Editor {...props} headingId={headingId} inputId={inputId} />
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p
            className={saved === undefined ? 'text-stone-600 dark:text-stone-400' : 'font-semibold'}
          >
            {saved === undefined
              ? t('myAnswers.notAnswered')
              : answerText(question, saved, locale, t)}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={props.onEdit}
              disabled={busy}
              aria-label={t(saved === undefined ? 'myAnswers.answerLabel' : 'myAnswers.editLabel', {
                question: text,
              })}
              className={`${secondaryButton} ${smallButton}`}
            >
              {saved === undefined ? t('myAnswers.answer') : t('myAnswers.edit')}
            </button>
            {saved !== undefined ? (
              <button
                type="button"
                onClick={props.onForget}
                disabled={busy}
                aria-label={t('myAnswers.forgetLabel', { question: text })}
                className={`${secondaryButton} ${smallButton}`}
              >
                {t('myAnswers.forget')}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </li>
  );
}

function Editor(props: ProfileQuestionProps & { headingId: string; inputId: string }) {
  const { question, t } = props;
  const [text, setText] = useState(() => toInputText(props.saved));
  const [problem, setProblem] = useState<AnswerProblem | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const problemId = useId();
  const hintId = useId();
  const hint = answerHint(question, t);

  // Opening the editor (also from "Change answer" in the banner) moves focus to the field.
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('input, textarea')?.focus();
  }, []);

  async function save() {
    const value = toAnswer(question, text);
    const check = checkAnswer(question, value);
    if (!check.ok) {
      setProblem(check.problem);
      return;
    }
    setProblem(null);
    const ok = await props.onSave(value as AnswerValue);
    setFailed(!ok);
    if (ok) props.onClose();
  }

  return (
    <div ref={box} className="mt-3">
      <AnswerField
        question={question}
        inputId={props.inputId}
        labelledBy={props.headingId}
        text={text}
        onText={setText}
        describedBy={[hint ? hintId : null, problem ? problemId : null].filter(Boolean).join(' ')}
        invalid={problem !== null}
        t={t}
        size="normal"
      />
      {hint ? (
        <p id={hintId} className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          {hint}
        </p>
      ) : null}
      {problem ? (
        <p id={problemId} role="alert" className="mt-2 font-medium text-red-700 dark:text-red-400">
          {t(`problem.${problem}`)}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="mt-2 font-medium text-red-700 dark:text-red-400">
          {t('remember.failed')}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={props.busy}
          className={`${primaryButton} ${smallButton}`}
        >
          {t('myAnswers.save')}
        </button>
        <button
          type="button"
          onClick={props.onClose}
          className={`${secondaryButton} ${smallButton}`}
        >
          {t('myAnswers.cancel')}
        </button>
      </div>
    </div>
  );
}
