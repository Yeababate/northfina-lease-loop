// The eligibility rules in data/questions.json, applied to a finished question flow:
// approved, declined or manual review, always with the checks that led there.
import type { CoefficientTable } from '@/data/schemas';
import type { AnswerValue } from './answer-check';
import { checkBusinessId } from './business-id';
import { ageOn } from './iso-date';
import type { Deal, FlowState } from './question-flow';

/** The ids of `eligibility_rules` in data/questions.json. */
export type EligibilityRuleId =
  | 'min_age'
  | 'residency'
  | 'affordability'
  | 'business_id'
  | 'pep_manual_review'
  | 'financed_limits';

/**
 * `not_applicable`: the rule does not cover this applicant or deal (no age check for a
 * company). `not_checked`: the flow stopped at a blocking answer before the rule's
 * question was answered.
 */
export type CheckResult = 'passed' | 'failed' | 'review' | 'not_applicable' | 'not_checked';

export type Check = {
  rule: EligibilityRuleId;
  result: CheckResult;
  /** On a failed affordability check: the highest monthly rent with VAT that would fit. */
  maxMonthlyRentWithVatCents?: number;
  /** On a failed financed_limits check: which end of the coefficient table was missed. */
  limit?: 'below_minimum' | 'above_maximum';
};

export type Decision =
  | { outcome: 'incomplete' }
  | {
      outcome: 'approved' | 'declined' | 'manual_review';
      /** The checks that decided the outcome: failed ones for a decline, review ones for a review. */
      reasons: Check[];
      /** Every rule, in the order of data/questions.json, for a "what we checked" list. */
      checks: Check[];
      /**
       * Who signs: `null` means the applicant. For a company whose applicant cannot sign,
       * the email of the authorised signatory, who is sent the contract to sign.
       */
      signatoryEmail: string | null;
    };

export type DecisionInput = {
  flow: FlowState;
  deal: Deal;
  /** Monthly rent including VAT, in cents, as the pricing engine quotes it for this deal. */
  monthlyRentWithVatCents: number;
  coefficientTable: CoefficientTable;
};

/** Rule min_age: consumers and sole traders must be 18 or older on the contract start date. */
const MIN_AGE = 18;
/** Rule residency: country codes we lease to. */
const ALLOWED_COUNTRIES = ['FI', 'SE', 'EE'];
/**
 * Rule affordability: rent with VAT at most 30 % of monthly net income, i.e.
 * rent × 10 ≤ income × 3, compared in whole cents so nothing is rounded.
 */
const AFFORDABILITY_NUMERATOR = 3;
const AFFORDABILITY_DENOMINATOR = 10;

const asString = (value: AnswerValue | undefined) => (typeof value === 'string' ? value : null);

/**
 * Applies the eligibility rules. A flow still in progress is `incomplete`. A flow stopped
 * by a blocking answer is always declined. Otherwise any failed rule declines, then any
 * rule that needs a person sends it to manual review, and only then is it approved: a
 * decline wins over a review, so nobody waits for a person to say no.
 */
export function decideApplication(input: DecisionInput): Decision {
  const { flow, deal, monthlyRentWithVatCents, coefficientTable } = input;
  if (flow.status === 'in_progress') return { outcome: 'incomplete' };
  if (!Number.isInteger(monthlyRentWithVatCents)) {
    throw new RangeError(
      `monthlyRentWithVatCents must be whole cents, got ${monthlyRentWithVatCents}`
    );
  }

  const answers = flow.answers;
  const customerType = asString(answers.q_customer_type);
  const isPerson = customerType === 'consumer' || customerType === 'sole_trader';
  const isBusiness = customerType === 'sole_trader' || customerType === 'company';
  // In a complete flow a missing answer means its question did not apply.
  const missing: CheckResult = flow.status === 'blocked' ? 'not_checked' : 'not_applicable';

  const checks: Check[] = [];

  checks.push({
    rule: 'min_age',
    result: answerRule(isPerson, asString(answers.q_birth_date), missing, (birthDate) => {
      return ageOn(birthDate, deal.startDate) >= MIN_AGE;
    }),
  });

  checks.push({
    rule: 'residency',
    result: answerRule(isPerson, asString(answers.q_country), missing, (country) =>
      ALLOWED_COUNTRIES.includes(country)
    ),
  });

  const income = answers.q_monthly_income;
  if (customerType !== 'consumer') {
    checks.push({ rule: 'affordability', result: 'not_applicable' });
  } else if (typeof income !== 'number') {
    checks.push({ rule: 'affordability', result: missing });
  } else if (
    monthlyRentWithVatCents * AFFORDABILITY_DENOMINATOR <=
    income * AFFORDABILITY_NUMERATOR
  ) {
    checks.push({ rule: 'affordability', result: 'passed' });
  } else {
    checks.push({
      rule: 'affordability',
      result: 'failed',
      maxMonthlyRentWithVatCents: Math.floor(
        (income * AFFORDABILITY_NUMERATOR) / AFFORDABILITY_DENOMINATOR
      ),
    });
  }

  checks.push({
    rule: 'business_id',
    result: answerRule(isBusiness, asString(answers.q_business_id), missing, (id) => {
      return checkBusinessId(id).ok;
    }),
  });

  const pep = asString(answers.q_pep);
  checks.push({
    rule: 'pep_manual_review',
    result: pep === 'yes' ? 'review' : pep === 'no' ? 'passed' : missing,
  });

  checks.push(financedLimitsCheck(coefficientTable, deal.financedAmountCents));

  const failed = checks.filter((check) => check.result === 'failed');
  const review = checks.filter((check) => check.result === 'review');
  const signatoryEmail =
    customerType === 'company' && answers.q_can_sign === 'no'
      ? asString(answers.q_signatory_email)
      : null;

  if (flow.status === 'blocked' || failed.length > 0) {
    return { outcome: 'declined', reasons: failed, checks, signatoryEmail };
  }
  if (review.length > 0) {
    return { outcome: 'manual_review', reasons: review, checks, signatoryEmail };
  }
  return { outcome: 'approved', reasons: [], checks, signatoryEmail };
}

/** A rule that applies to some applicants and is decided by one answer. */
function answerRule(
  applies: boolean,
  answer: string | null,
  missing: CheckResult,
  passes: (answer: string) => boolean
): CheckResult {
  if (!applies) return 'not_applicable';
  if (answer === null) return missing;
  return passes(answer) ? 'passed' : 'failed';
}

/** Rule financed_limits: the amount must fall inside one of the coefficient table's bands. */
function financedLimitsCheck(table: CoefficientTable, financedCents: number): Check {
  const lowest = Math.min(...table.bands.map((band) => band.min_financed_cents));
  const highest = Math.max(...table.bands.map((band) => band.max_financed_cents));
  if (financedCents < lowest) {
    return { rule: 'financed_limits', result: 'failed', limit: 'below_minimum' };
  }
  if (financedCents > highest) {
    return { rule: 'financed_limits', result: 'failed', limit: 'above_maximum' };
  }
  return { rule: 'financed_limits', result: 'passed' };
}
