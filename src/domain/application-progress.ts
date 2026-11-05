// What the question screen needs on top of the flow: where the customer is, how much is
// left, where Back goes, and which rule a blocking answer broke. Pure helpers around
// resolveFlow (./question-flow.ts) so the page holds no logic of its own.
import type { EligibilityRuleId } from './eligibility';
import type { Block, FlowState } from './question-flow';

export type Progress = {
  /** 1-based number of the question on screen. */
  current: number;
  /** About how many questions in all. Can grow when an answer opens new questions. */
  aboutTotal: number;
  /** Whole minutes left, never below 1 while questions remain. */
  minutesLeft: number;
};

/** Rough time per question, for "about 2 minutes left". Most questions are one click. */
const SECONDS_PER_QUESTION = 20;

/**
 * Progress for the question on screen. `editingId` is set while the customer has gone back
 * to an earlier answer; otherwise the screen shows `flow.next`.
 */
export function progressOf(flow: FlowState, editingId: string | null): Progress {
  const editingIndex = editingId === null ? -1 : flow.answered.indexOf(editingId);
  const aboutTotal = flow.answered.length + flow.remaining;
  const current = editingIndex >= 0 ? editingIndex + 1 : flow.answered.length + 1;
  const left = Math.max(0, aboutTotal - current + 1);
  return {
    current: Math.min(current, Math.max(aboutTotal, 1)),
    aboutTotal: Math.max(aboutTotal, 1),
    minutesLeft: left === 0 ? 0 : Math.max(1, Math.ceil((left * SECONDS_PER_QUESTION) / 60)),
  };
}

/**
 * The question Back goes to: the answered question just before the one on screen, or null
 * when the customer is on the first question (Back then leaves the application).
 */
export function previousQuestionId(answered: readonly string[], onScreenId: string): string | null {
  const index = answered.indexOf(onScreenId);
  if (index === -1) return answered.at(-1) ?? null; // on a new question: the last answer
  return index === 0 ? null : (answered[index - 1] ?? null);
}

/** The eligibility rule behind a blocking answer, to explain it the same way as a decline. */
export function ruleForBlock(block: Block): EligibilityRuleId | null {
  if (block.rule === 'age_under') return 'min_age';
  if (block.questionId === 'q_country') return 'residency';
  return null;
}
