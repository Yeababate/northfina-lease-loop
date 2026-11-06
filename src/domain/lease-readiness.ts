// Per-item lease readiness from remembered answers (#51): can this user lease this item
// straight away, how many questions are still missing for it, or do their answers already
// guarantee a manual review or a no? A remembered profile is not a decision: the same
// answers are evaluated against each deal, because which questions apply and the outcome
// both depend on the item, the amount and the rent.
import type { CoefficientTable, Question } from '@/data/schemas';
import type { Answers, AnswerValue } from './answer-check';
import { isRememberable } from './answer-scope';
import { decideApplication, type EligibilityRuleId } from './eligibility';
import { questionApplies, resolveFlow, type Deal, type FlowState } from './question-flow';

/**
 * Strongest known outcome first: `not_leasable` (the item, whatever the answers) >
 * `declined` > `manual_review` > `missing` > `ready`. A result can be missing answers and
 * already be doomed; `missing` is then still filled in.
 */
export type ReadinessStatus = 'not_leasable' | 'declined' | 'manual_review' | 'missing' | 'ready';

/** Why the item itself cannot be leased: its status, or no price for this deal. */
export type ItemProblem = 'not_available' | 'not_priceable' | 'financed_limits';

/** The item side of the check, worked out by the caller with the signing-day prices. */
export type ReadinessItem =
  { ok: true; deal: Deal; monthlyRentWithVatCents: number } | { ok: false; problem: ItemProblem };

export type Readiness = {
  status: ReadinessStatus;
  /** For `not_leasable`. */
  itemProblem?: ItemProblem;
  /** For `declined` and `manual_review`: the rules that already decide it. */
  reasons: EligibilityRuleId[];
  /** Applicable profile questions with no remembered answer, in question order. */
  missing: { count: number; questionIds: string[] };
  /** Questions about this one lease, asked at application time and never remembered. */
  dealQuestionIds: string[];
  /** A company whose applicant cannot sign: the named signatory signs instead. */
  signatoryRequired: boolean;
  /** On a failed affordability check: the highest monthly rent with VAT that would fit. */
  maxMonthlyRentWithVatCents?: number;
};

export type ReadinessInput = {
  /** Remembered answers, including the ones the profile key implies. `{}` when signed out. */
  savedAnswers: Answers;
  item: ReadinessItem;
  questions: readonly Question[];
  coefficientTable: CoefficientTable;
};

const NOT_LEASABLE = (problem: ItemProblem): Readiness => ({
  status: 'not_leasable',
  itemProblem: problem,
  reasons: [],
  missing: { count: 0, questionIds: [] },
  dealQuestionIds: [],
  signatoryRequired: false,
});

/** Only remembered answers count; a deal-level answer is never carried over. */
function rememberedOnly(answers: Answers): Answers {
  const kept: Record<string, AnswerValue> = {};
  for (const [id, value] of Object.entries(answers)) {
    if (isRememberable(id)) kept[id] = value;
  }
  return kept;
}

/**
 * Applicable questions without a valid answer. Like `resolveFlow.remaining` this is a lower
 * bound: a follow-up (`q_signatory_email`) is counted only once its parent answer is known.
 */
function unanswered(questions: readonly Question[], deal: Deal, flow: FlowState): Question[] {
  return questions.filter(
    (question) =>
      flow.answers[question.id] === undefined && questionApplies(question, deal, flow.answers)
  );
}

/**
 * Evaluates remembered answers against one item. Missing answers are left out of the
 * decision (`decideApplication` sees a finished flow), so only rules that the known answers
 * already break or send to a person count: a decline or review found that way cannot be
 * undone by answering the remaining questions, because every rule is decided by one answer
 * and answers are not overwritten by later ones.
 */
export function leaseReadiness(input: ReadinessInput): Readiness {
  const { item, questions, coefficientTable } = input;
  if (!item.ok) return NOT_LEASABLE(item.problem);

  const flow = resolveFlow(questions, item.deal, rememberedOnly(input.savedAnswers));
  const open = unanswered(questions, item.deal, flow);
  const missingIds = open.filter((q) => isRememberable(q.id)).map((q) => q.id);
  const dealQuestionIds = open.filter((q) => !isRememberable(q.id)).map((q) => q.id);

  // A blocked flow is decided as it stands; otherwise pretend it is finished so the rules
  // see every known answer and treat the missing ones as not applicable.
  const decision = decideApplication({
    flow:
      flow.status === 'blocked' ? flow : { ...flow, status: 'complete', next: null, remaining: 0 },
    deal: item.deal,
    monthlyRentWithVatCents: item.monthlyRentWithVatCents,
    coefficientTable,
  });
  if (decision.outcome === 'incomplete') throw new Error('A finished flow is always decided');

  if (decision.checks.some((c) => c.rule === 'financed_limits' && c.result === 'failed')) {
    return NOT_LEASABLE('financed_limits');
  }

  const base = {
    missing: { count: missingIds.length, questionIds: missingIds },
    dealQuestionIds,
    signatoryRequired: decision.signatoryEmail !== null || flow.answers.q_can_sign === 'no',
  };
  if (decision.outcome === 'declined') {
    const cap = decision.reasons.find((c) => c.maxMonthlyRentWithVatCents !== undefined);
    return {
      status: 'declined',
      reasons: decision.reasons.map((c) => c.rule),
      ...base,
      ...(cap ? { maxMonthlyRentWithVatCents: cap.maxMonthlyRentWithVatCents } : {}),
    };
  }
  if (decision.outcome === 'manual_review') {
    return { status: 'manual_review', reasons: decision.reasons.map((c) => c.rule), ...base };
  }
  return { status: missingIds.length > 0 ? 'missing' : 'ready', reasons: [], ...base };
}
