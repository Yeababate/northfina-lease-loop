// Which application answers a user may remember on their profile (#51), and how a
// remembered set is keyed. A person who is both a consumer and a company director keeps
// separate sets: `consumer`, `sole_trader` and `company:<business id>`.
import type { Question } from '@/data/schemas';
import { checkAnswer, type Answers, type AnswerValue } from './answer-check';
import { checkBusinessId } from './business-id';
import { conditionHolds, type Deal } from './question-flow';

/**
 * `profile`: about the person or organisation, the same for every deal, so it can be
 * remembered. `deal`: about this one lease (what the item is for), never remembered.
 */
export type AnswerScope = 'profile' | 'deal';

/** Every question id in data/questions.json. A test fails when a new question is not here. */
export const ANSWER_SCOPES: Readonly<Record<string, AnswerScope>> = {
  q_customer_type: 'profile',
  q_full_name: 'profile',
  q_birth_date: 'profile',
  q_email: 'profile',
  q_country: 'profile',
  q_employment: 'profile',
  q_monthly_income: 'profile',
  q_business_id: 'profile',
  q_company_name: 'profile',
  q_can_sign: 'profile',
  q_signatory_email: 'profile',
  q_vat_registered: 'profile',
  q_usage_purpose: 'deal',
  q_farm_registry: 'profile',
  q_annual_revenue: 'profile',
  q_beneficial_owners: 'profile',
  q_pep: 'profile',
  q_pep_details: 'profile',
};

/** True only for a known question that may be remembered. Unknown ids are never remembered. */
export function isRememberable(questionId: string): boolean {
  return ANSWER_SCOPES[questionId] === 'profile';
}

export type CustomerType = 'consumer' | 'sole_trader' | 'company';

/** A parsed profile key. A company set belongs to one business id. */
export type ProfileKey =
  | { customerType: 'consumer' | 'sole_trader'; key: 'consumer' | 'sole_trader' }
  | { customerType: 'company'; businessId: string; key: `company:${string}` };

/**
 * Parses `consumer`, `sole_trader` or `company:<business id>`. A company key needs a valid
 * Finnish business id (format and check digit), the same check the application uses, so a
 * set is never stored under an id the application would reject.
 */
export function parseProfileKey(input: string): ProfileKey | null {
  if (input === 'consumer' || input === 'sole_trader') {
    return { customerType: input, key: input };
  }
  if (!input.startsWith('company:')) return null;
  const businessId = input.slice('company:'.length);
  if (businessId !== businessId.trim() || !checkBusinessId(businessId).ok) return null;
  return { customerType: 'company', businessId, key: `company:${businessId}` };
}

/**
 * Answers that the key itself gives: the customer type, and for a company its business id.
 * They are never stored as separate rows, so they can never disagree with the key.
 */
export function impliedAnswers(profile: ProfileKey): Answers {
  if (profile.customerType === 'company') {
    return { q_customer_type: 'company', q_business_id: profile.businessId };
  }
  return { q_customer_type: profile.customerType };
}

/** True when the key already fixes this answer, so it cannot be saved on its own. */
export function isImpliedByKey(profile: ProfileKey, questionId: string): boolean {
  return impliedAnswers(profile)[questionId] !== undefined;
}

/** Deal fields that no profile answer can know. Their conditions are treated as possible. */
const DEAL_FIELDS = new Set(['category', 'financed_amount_cents', 'term_months']);

/** A placeholder deal: only used for conditions on answers, never on deal fields. */
const NO_DEAL: Deal = { category: 'e_bike', financedAmountCents: 0, termMonths: 0, startDate: '' };

/**
 * True when `question` could be asked of this profile for some item: its conditions on the
 * customer type and on earlier answers hold for `known`, and conditions on the item, amount
 * or term are treated as possible (`q_pep` is asked only from €10,000, but some items cost
 * that much). `known` must include the answers the profile key implies.
 */
export function couldApplyToProfile(question: Question, known: Answers): boolean {
  return question.ask_when.every(
    (condition) => DEAL_FIELDS.has(condition.field) || conditionHolds(condition, NO_DEAL, known)
  );
}

export type PrunedProfile = {
  /** The remembered answers that still count, without the implied ones. */
  answers: Record<string, AnswerValue>;
  /** Ids whose saved answer no longer applies, for example after the user changed a parent. */
  removed: string[];
};

/**
 * Drops remembered answers that no longer apply, the way `resolveFlow` drops answers when
 * an earlier one changes (for example `q_signatory_email` after `q_can_sign` becomes yes).
 *
 * A profile is not a deal, so only conditions on the customer type and on other answers are
 * checked; a condition on the item or amount (`q_pep` is asked only from €10,000) could hold
 * for some deal, so the answer is kept. Questions are walked in file order, which puts every
 * question after the answers it depends on. Invalid and deal-level answers are removed too.
 */
export function pruneProfileAnswers(
  questions: readonly Question[],
  profile: ProfileKey,
  saved: Answers
): PrunedProfile {
  const implied = impliedAnswers(profile);
  const known: Record<string, AnswerValue> = { ...implied };
  const answers: Record<string, AnswerValue> = {};
  const removed: string[] = [];
  const asked = new Set(questions.map((question) => question.id));

  for (const question of questions) {
    if (implied[question.id] !== undefined) continue;
    const value = saved[question.id];
    if (value === undefined) continue;
    if (
      !couldApplyToProfile(question, known) ||
      !isRememberable(question.id) ||
      !checkAnswer(question, value).ok
    ) {
      removed.push(question.id);
      continue;
    }
    known[question.id] = value;
    answers[question.id] = value;
  }
  // Saved ids that are not questions any more (the data pack changed) are dropped as well.
  for (const id of Object.keys(saved)) {
    if (!asked.has(id) && implied[id] === undefined) removed.push(id);
  }
  return { answers, removed };
}
