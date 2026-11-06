'use client';

// The application, one question at a time, ending in the decision. All rules live in
// src/domain: resolveFlow picks the question and drops answers that stop applying,
// checkAnswer validates, decideApplication decides. This component only keeps the answers.
//
// Answers are kept in sessionStorage for this tab, so a reload or a language switch does not
// lose them. They are never put in the URL, because they are personal data.
import { useMemo, useState, type ReactNode } from 'react';
import type { CoefficientTable, Question } from '@/data/schemas';
import {
  checkAnswer,
  type AnswerProblem,
  type Answers,
  type AnswerValue,
} from '@/domain/answer-check';
import { previousQuestionId, progressOf } from '@/domain/application-progress';
import { decideApplication } from '@/domain/eligibility';
import { resolveFlow, type Deal } from '@/domain/question-flow';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { InfoBox } from '../ui';
import { questionText } from './answer-text';
import { AnswersPanel } from './answers-panel';
import { DecisionView } from './decision-view';
import { QuestionStep } from './question-step';
import { saveAnswers, useSavedAnswers } from './saved-answers';

type ApplicationWizardProps = {
  locale: Locale;
  questions: readonly Question[];
  deal: Deal;
  coefficientTable: CoefficientTable;
  monthlyRentWithVatCents: number;
  /** Unique per item and lease choice, so two applications never share answers. */
  storageKey: string;
  links: { item: string; sign: string; catalogue: string };
  /** Suggested answers shown in empty fields, e.g. the demo name for "Your full name". */
  prefill?: Answers;
  /** The price and VAT note, shown above the question and the decision. */
  intro?: ReactNode;
};

export function ApplicationWizard(props: ApplicationWizardProps) {
  const { locale, questions, deal } = props;
  const t = getT(locale);

  // Saved answers from this tab; empty on the server and before the page is interactive.
  const savedAnswers = useSavedAnswers(props.storageKey);
  // null until the customer answers something here; until then the saved answers apply.
  const [ownAnswers, setOwnAnswers] = useState<Answers | null>(null);
  const answers = ownAnswers ?? savedAnswers;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [problem, setProblem] = useState<AnswerProblem | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [interacted, setInteracted] = useState(false);

  const flow = useMemo(() => resolveFlow(questions, deal, answers), [questions, deal, answers]);
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const editing = editingId ? (byId.get(editingId) ?? null) : null;
  const onScreen = editing ?? flow.next?.question ?? null;

  function save(next: Answers) {
    setOwnAnswers(next);
    saveAnswers(props.storageKey, next);
  }

  function submit(question: Question, value: AnswerValue | undefined) {
    setInteracted(true);
    const check = checkAnswer(question, value);
    if (!check.ok) {
      setProblem(check.problem);
      return;
    }
    const next = resolveFlow(questions, deal, { ...answers, [question.id]: value as AnswerValue });
    save(next.answers);
    setRemoved(next.removed);
    setProblem(null);
    setEditingId(null);
  }

  function goTo(questionId: string | null) {
    setInteracted(true);
    setProblem(null);
    setRemoved([]);
    setEditingId(questionId);
  }

  const panel = (
    <AnswersPanel
      questions={questions}
      answered={flow.answered}
      answers={flow.answers}
      locale={locale}
      t={t}
      onChange={goTo}
    />
  );

  const decision =
    onScreen === null
      ? decideApplication({
          flow,
          deal,
          monthlyRentWithVatCents: props.monthlyRentWithVatCents,
          coefficientTable: props.coefficientTable,
        })
      : null;

  // Two columns from lg: question or decision on the left, answers as a side bar on the right
  // (a third of the width). Below lg it stacks, with the answers under the question.
  const layout = (main: ReactNode) => (
    <div className="grid gap-8 lg:grid-cols-3 lg:gap-10">
      <div className="min-w-0 lg:col-span-2">
        {props.intro}
        {main}
      </div>
      <aside className="lg:sticky lg:top-6 lg:self-start">{panel}</aside>
    </div>
  );

  if (decision && decision.outcome !== 'incomplete') {
    const bands = props.coefficientTable.bands;
    return layout(
      <DecisionView
        decision={decision}
        flow={flow}
        monthlyRentWithVatCents={props.monthlyRentWithVatCents}
        minFinancedCents={Math.min(...bands.map((b) => b.min_financed_cents))}
        maxFinancedCents={Math.max(...bands.map((b) => b.max_financed_cents))}
        links={{ ...props.links, changeLease: props.links.item }}
        locale={locale}
        t={t}
      />
    );
  }
  if (!onScreen) return null; // unreachable: no question means a decision

  const progress = progressOf(flow, editing ? editing.id : null);
  const previous = previousQuestionId(flow.answered, onScreen.id);
  // A problem from resolveFlow (a stored answer that became invalid) shows until fixed.
  const shownProblem = problem ?? (editing ? null : (flow.next?.problem ?? null));

  return layout(
    <div className="max-w-xl">
      <div className="flex justify-between gap-4 text-sm text-stone-700 dark:text-stone-300">
        <p>{t('apply.progress', { current: progress.current, total: progress.aboutTotal })}</p>
        <p>{t('apply.minutesLeft', { minutes: progress.minutesLeft })}</p>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.aboutTotal}
        aria-valuenow={progress.current - 1}
        aria-label={t('apply.progress', {
          current: progress.current,
          total: progress.aboutTotal,
        })}
        className="mt-2 h-1.5 rounded-full bg-stone-200 dark:bg-stone-800"
      >
        <div
          className="h-full rounded-full bg-blue-600 transition-[width] dark:bg-blue-400"
          style={{ width: `${((progress.current - 1) / progress.aboutTotal) * 100}%` }}
        />
      </div>

      {removed.length > 0 ? (
        <div className="mt-6" role="status">
          <InfoBox>
            {t('apply.removed', {
              questions: removed
                .map((id) => byId.get(id))
                .filter((q): q is Question => q !== undefined)
                .map((q) => questionText(q, locale))
                .join(', '),
            })}
          </InfoBox>
        </div>
      ) : null}

      <QuestionStep
        key={onScreen.id}
        question={onScreen}
        initialValue={answers[onScreen.id] ?? props.prefill?.[onScreen.id]}
        problem={shownProblem}
        locale={locale}
        t={t}
        focusOnMount={interacted}
        back={previous === null ? { href: props.links.item } : { onClick: () => goTo(previous) }}
        onSubmit={(value) => submit(onScreen, value)}
      />
      <p className="mt-4 text-sm text-stone-600 dark:text-stone-400">{t('apply.changeNote')}</p>
    </div>
  );
}
