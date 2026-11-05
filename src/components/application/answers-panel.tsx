// "Your answers so far": every answer that still counts, each with a Change button.
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
  locale: Locale;
  t: Translate;
  onChange: (questionId: string) => void;
};

export function AnswersPanel(props: AnswersPanelProps) {
  const { questions, answered, answers, locale, t } = props;
  const byId = new Map(questions.map((q) => [q.id, q]));

  return (
    <section
      aria-labelledby="answers-so-far"
      className="rounded-2xl border border-stone-300 p-5 dark:border-stone-700"
    >
      <h2 id="answers-so-far" className="text-lg font-semibold">
        {t('apply.answersSoFar')}
      </h2>
      {answered.length === 0 ? (
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{t('apply.noAnswersYet')}</p>
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
    </section>
  );
}
