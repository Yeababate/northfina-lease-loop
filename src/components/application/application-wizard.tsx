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
import {
  answersToRemember,
  canRemember,
  chooseProfileSet,
  customerTypeOf,
  prefillFromProfile,
  profileKeyFromAnswers,
  rememberState,
  sameAnswer,
  savedAnswersOf,
  type RememberedSetView,
} from '@/domain/remembered-answers';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { InfoBox } from '../ui';
import { answerText, questionText } from './answer-text';
import { AnswersPanel, type AnswerTag } from './answers-panel';
import { DecisionView } from './decision-view';
import { QuestionStep } from './question-step';
import { RememberAnswers, RememberToggle } from './remember-answers';
import { saveAnswers, useSavedAnswers } from './saved-answers';
import { useRememberedAnswers } from './use-remembered-answers';

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
  /** The user's remembered answer sets (#52); null when signed out. */
  remembered: readonly RememberedSetView[] | null;
};

export function ApplicationWizard(props: ApplicationWizardProps) {
  const { locale, questions, deal } = props;
  const t = getT(locale);

  // Saved answers from this tab; empty on the server and before the page is interactive.
  const savedAnswers = useSavedAnswers(props.storageKey);
  // null until the customer answers something here; until then the saved answers apply.
  const [ownAnswers, setOwnAnswers] = useState<Answers | null>(null);
  const own = ownAnswers ?? savedAnswers;
  // Remembered answers fill in underneath; anything answered in this tab wins (#52).
  const store = useRememberedAnswers(props.remembered);
  const answers = useMemo(() => prefillFromProfile(store.sets, own), [store.sets, own]);
  // Questions answered in this application, and those whose "Remember" box was unticked.
  const [answeredHere, setAnsweredHere] = useState<ReadonlySet<string>>(new Set());
  const [rememberOff, setRememberOff] = useState<ReadonlySet<string>>(new Set());
  const [justSaved, setJustSaved] = useState(false);

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
    setJustSaved(false);
    const check = checkAnswer(question, value);
    if (!check.ok) {
      setProblem(check.problem);
      return;
    }
    const given = { ...flow.answers, [question.id]: value as AnswerValue };
    const next = resolveFlow(questions, deal, prefillFromProfile(store.sets, given));
    save(next.answers);
    // Only answers that counted before are "removed"; remembered answers that never applied
    // to this item (PEP below €10,000) were never shown, so they are not news.
    setRemoved(next.removed.filter((id) => flow.answers[id] !== undefined));
    const here = new Set(answeredHere).add(question.id);
    setAnsweredHere(here);
    setProblem(null);
    setEditingId(null);
    void remember(next.answers, here);
  }

  /**
   * Saves every answer given in this application whose box is ticked and that the profile
   * does not have yet. Earlier answers are included: a company's first answers wait until
   * its business id is known. Answers that only came from another set are never copied.
   */
  async function remember(next: Answers, here: ReadonlySet<string>) {
    if (!store.signedIn) return;
    const key = profileKeyFromAnswers(next);
    const entries = answersToRemember(questions, next, key, savedAnswersOf(store.sets, key)).filter(
      ([id]) => here.has(id) && !rememberOff.has(id)
    );
    if (key && entries.length > 0) setJustSaved(await store.save(key.key, entries));
  }

  function setRemember(questionId: string, on: boolean) {
    const next = new Set(rememberOff);
    if (on) next.delete(questionId);
    else next.add(questionId);
    setRememberOff(next);
  }

  function goTo(questionId: string | null) {
    setInteracted(true);
    setProblem(null);
    setRemoved([]);
    setEditingId(questionId);
  }

  // "From your profile" or "Saved" beside answers the chosen remembered set has.
  const profile = chooseProfileSet(store.sets, flow.answers);
  const tags: Record<string, AnswerTag> = {};
  for (const id of flow.answered) {
    if (profile && sameAnswer(profile.answers[id], flow.answers[id])) {
      tags[id] = answeredHere.has(id) ? 'saved' : 'profile';
    }
  }
  const prefilled = Object.values(tags).filter((tag) => tag === 'profile').length;

  const panel = (
    <AnswersPanel
      questions={questions}
      answered={flow.answered}
      answers={flow.answers}
      tags={tags}
      locale={locale}
      t={t}
      onChange={goTo}
    />
  );

  const rememberStatus = store.busy ? (
    <p role="status" className="mt-4 text-sm">
      {t('remember.saving')}
    </p>
  ) : store.failed ? (
    <p role="status" className="mt-4 text-sm font-medium text-red-700 dark:text-red-400">
      {t('remember.failed')}
    </p>
  ) : (
    <p role="status" className="mt-4 text-sm text-green-800 dark:text-green-300">
      {justSaved ? (
        <>
          <span aria-hidden="true">✓ </span>
          {t('remember.saved')}
        </>
      ) : null}
    </p>
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
      <>
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
        <div className="mt-6 max-w-2xl">
          <RememberAnswers
            questions={questions}
            answers={flow.answers}
            store={store}
            locale={locale}
            t={t}
          />
        </div>
      </>
    );
  }
  if (!onScreen) return null; // unreachable: no question means a decision

  const progress = progressOf(flow, editing ? editing.id : null);
  const previous = previousQuestionId(flow.answered, onScreen.id);
  // A problem from resolveFlow (a stored answer that became invalid) shows until fixed.
  const shownProblem = problem ?? (editing ? null : (flow.next?.problem ?? null));

  // "Remember this answer", on by default when signed in (#52).
  const key = profileKeyFromAnswers(flow.answers);
  const current = answers[onScreen.id];
  const savedValue = savedAnswersOf(store.sets, key)[onScreen.id];
  const rememberToggle =
    store.signedIn && canRemember(onScreen.id, customerTypeOf(flow.answers)) ? (
      <RememberToggle
        checked={!rememberOff.has(onScreen.id)}
        onChange={(on) => setRemember(onScreen.id, on)}
        state={
          key
            ? rememberState(onScreen.id, current, key, savedAnswersOf(store.sets, key))
            : 'unsaved'
        }
        savedText={savedValue === undefined ? null : answerText(onScreen, savedValue, locale, t)}
        t={t}
      />
    ) : null;

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

      {prefilled > 0 && !interacted ? (
        <div className="mt-6" role="status">
          <InfoBox>{t('remember.prefilled', { count: prefilled })}</InfoBox>
        </div>
      ) : null}

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
        remember={rememberToggle}
      />
      {rememberStatus}
      <p className="mt-4 text-sm text-stone-600 dark:text-stone-400">{t('apply.changeNote')}</p>
      {store.signedIn ? null : (
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{t('remember.signedOut')}</p>
      )}
    </div>
  );
}
