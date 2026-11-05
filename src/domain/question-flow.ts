// The smart question flow: given the deal and the answers so far, which question comes
// next, which answers still count, and whether an answer stops the application.
// The questions, their order and their rules all come from data/questions.json.
import type { AskWhenCondition, AssetCategory, Question } from '@/data/schemas';
import { checkAnswer, type AnswerProblem, type Answers, type AnswerValue } from './answer-check';
import { ageOn } from './iso-date';

/** What the application is for. Chosen before the questions start (catalogue and sliders). */
export type Deal = {
  category: AssetCategory;
  /** List price minus down payment, in cents. */
  financedAmountCents: number;
  termMonths: number;
  /** Contract start date, `YYYY-MM-DD`. Age rules are checked on this day. */
  startDate: string;
};

export type Block = { questionId: string; rule: 'age_under' | 'answer_in' };

export type FlowState = {
  /**
   * `in_progress`: `next` is the question to show. `blocked`: an answer stops the
   * application, so no more questions are asked. `complete`: every question that applies
   * has a valid answer, so the application can be decided.
   */
  status: 'in_progress' | 'blocked' | 'complete';
  /** The question to show now, with the problem of its current answer if it has an invalid one. */
  next: { question: Question; problem?: AnswerProblem } | null;
  /** The first answer that stops the application, in question order. */
  block: Block | null;
  /** Only the answers that still count: their question applies and the answer is valid. */
  answers: Answers;
  /** Ids of the answered questions, in the order they are asked ("your answers so far"). */
  answered: string[];
  /**
   * Ids of questions whose answers were dropped because the question no longer applies,
   * for the "we removed these answers" notice. Replace your stored answers with `answers`.
   */
  removed: string[];
  /**
   * Questions still to answer, `next` included. A lower bound: a question that depends on
   * an answer not given yet is not counted until that answer is known.
   */
  remaining: number;
};

/** The value a condition looks at, or `undefined` while it is not known. */
function fieldValue(field: string, deal: Deal, answers: Answers): AnswerValue | undefined {
  if (field === 'customer_type') return answers.q_customer_type;
  if (field === 'category') return deal.category;
  if (field === 'financed_amount_cents') return deal.financedAmountCents;
  if (field === 'term_months') return deal.termMonths;
  if (field.startsWith('answers.')) return answers[field.slice('answers.'.length)];
  return undefined;
}

/** One `ask_when` condition. An unknown value never matches, so the question waits. */
export function conditionHolds(condition: AskWhenCondition, deal: Deal, answers: Answers): boolean {
  const value = fieldValue(condition.field, deal, answers);
  switch (condition.op) {
    case 'in':
      return typeof value === 'string' && condition.value.includes(value);
    case 'gte':
      return typeof value === 'number' && value >= condition.value;
    case 'lte':
      return typeof value === 'number' && value <= condition.value;
  }
}

/** A question is asked when every condition in `ask_when` holds (an empty list: always). */
export function questionApplies(question: Question, deal: Deal, answers: Answers): boolean {
  return question.ask_when.every((condition) => conditionHolds(condition, deal, answers));
}

/** The block rule this valid answer breaks, if any. */
function blockRuleHit(question: Question, value: AnswerValue, deal: Deal): Block['rule'] | null {
  for (const block of question.blocks_application_when ?? []) {
    if (block.rule === 'age_under' && typeof value === 'string') {
      if (ageOn(value, deal.startDate) < block.value) return 'age_under';
    }
    if (block.rule === 'answer_in' && typeof value === 'string') {
      if (block.value.includes(value)) return 'answer_in';
    }
  }
  return null;
}

/**
 * Works out the state of an application from scratch. Call it after every answer, also
 * when the customer goes back and changes one: the answers are re-checked in question
 * order, so an answer that removes a later question also drops that question's answer.
 *
 * Questions are walked in file order, which puts every question after the answers its
 * `ask_when` depends on. After a blocking answer no question is offered, but valid later
 * answers are kept, so fixing the blocking answer does not lose them.
 */
export function resolveFlow(
  questions: readonly Question[],
  deal: Deal,
  rawAnswers: Answers
): FlowState {
  const answers: Record<string, AnswerValue> = {};
  const answered: string[] = [];
  const removed: string[] = [];
  let next: FlowState['next'] = null;
  let block: Block | null = null;
  let remaining = 0;

  for (const question of questions) {
    const value = rawAnswers[question.id];

    if (!questionApplies(question, deal, answers)) {
      if (value !== undefined) removed.push(question.id);
      continue;
    }

    const check = checkAnswer(question, value);
    if (value === undefined || !check.ok) {
      remaining += 1;
      if (next === null) {
        // A missing answer is simply the next question; an invalid one comes with its problem.
        next =
          check.ok || check.problem === 'empty'
            ? { question }
            : { question, problem: check.problem };
      }
      continue;
    }

    answers[question.id] = value;
    answered.push(question.id);
    const rule: Block['rule'] | null = block === null ? blockRuleHit(question, value, deal) : null;
    if (rule !== null) block = { questionId: question.id, rule };
  }

  if (block !== null) {
    return { status: 'blocked', next: null, block, answers, answered, removed, remaining: 0 };
  }
  return {
    status: next === null ? 'complete' : 'in_progress',
    next,
    block: null,
    answers,
    answered,
    removed,
    remaining,
  };
}
