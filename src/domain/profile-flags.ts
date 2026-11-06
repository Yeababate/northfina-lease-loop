// Sticky profile flags (#51): remembered answers that affect every deal, or every deal of
// some kind, so the profile page can say so once instead of on every item.
import type { Question } from '@/data/schemas';
import type { Answers } from './answer-check';
import type { CustomerType, ProfileKey } from './answer-scope';
import {
  AFFORDABILITY_DENOMINATOR,
  AFFORDABILITY_NUMERATOR,
  ALLOWED_COUNTRIES,
  MIN_AGE,
} from './eligibility';
import { ageOn, isIsoDate } from './iso-date';

export type ProfileFlag =
  /** Every deal from `minFinancedCents` goes to manual review. */
  | { id: 'pep_yes'; questionId: 'q_pep'; effect: 'manual_review'; minFinancedCents: number }
  /** Declined for consumer and sole-trader deals that start before `until`. */
  | {
      id: 'under_18';
      questionId: 'q_birth_date';
      effect: 'declined';
      appliesTo: CustomerType[];
      until: string;
    }
  /** Declined for every deal: we lease only to residents of FI, SE and EE. */
  | { id: 'country_not_supported'; questionId: 'q_country'; effect: 'declined' }
  /** Company deals need the named signatory to sign. */
  | { id: 'cannot_sign_for_company'; questionId: 'q_can_sign'; effect: 'signatory_required' }
  /**
   * Affordability depends on the rent, so it is never decided by the profile alone. The
   * flag gives the highest monthly rent with VAT the income allows; any dearer lease is
   * declined. Present whenever a consumer has saved an income.
   */
  | {
      id: 'income_low';
      questionId: 'q_monthly_income';
      effect: 'rent_cap';
      maxMonthlyRentWithVatCents: number;
    };

/**
 * The first day someone born on `birthDate` is `years` old, matching `ageOn`: a person born
 * on 29 February has their birthday on 1 March in other years.
 */
export function birthdayAt(birthDate: string, years: number): string {
  if (!isIsoDate(birthDate)) throw new RangeError(`birthdayAt needs an ISO date, got ${birthDate}`);
  const year = String(Number(birthDate.slice(0, 4)) + years).padStart(4, '0');
  const sameDay = `${year}${birthDate.slice(4)}`;
  return isIsoDate(sameDay) ? sameDay : `${year}-03-01`;
}

/** The amount from which `q_pep` is asked, read from its `ask_when` (0 when always asked). */
function pepThreshold(questions: readonly Question[]): number {
  const pep = questions.find((question) => question.id === 'q_pep');
  const condition = pep?.ask_when.find(
    (c) => c.field === 'financed_amount_cents' && c.op === 'gte'
  );
  return condition && typeof condition.value === 'number' ? condition.value : 0;
}

/**
 * Flags for one remembered set, in a fixed order. `today` is used only for the age flag:
 * someone already 18 has no flag, even though a deal is checked on its start date.
 * Income cap: rent × 10 ≤ income × 3 (eligibility.ts), so the cap is floor(income × 3 / 10)
 * in whole cents, rounded down so the cap itself always passes.
 */
export function profileFlags(
  profile: ProfileKey,
  answers: Answers,
  questions: readonly Question[],
  today: string
): ProfileFlag[] {
  const flags: ProfileFlag[] = [];
  const isPerson = profile.customerType !== 'company';

  if (answers.q_pep === 'yes') {
    flags.push({
      id: 'pep_yes',
      questionId: 'q_pep',
      effect: 'manual_review',
      minFinancedCents: pepThreshold(questions),
    });
  }

  const birthDate = answers.q_birth_date;
  if (isPerson && typeof birthDate === 'string' && isIsoDate(birthDate)) {
    if (ageOn(birthDate, today) < MIN_AGE) {
      flags.push({
        id: 'under_18',
        questionId: 'q_birth_date',
        effect: 'declined',
        appliesTo: ['consumer', 'sole_trader'],
        until: birthdayAt(birthDate, MIN_AGE),
      });
    }
  }

  const country = answers.q_country;
  if (isPerson && typeof country === 'string' && !ALLOWED_COUNTRIES.includes(country)) {
    flags.push({ id: 'country_not_supported', questionId: 'q_country', effect: 'declined' });
  }

  if (profile.customerType === 'company' && answers.q_can_sign === 'no') {
    flags.push({
      id: 'cannot_sign_for_company',
      questionId: 'q_can_sign',
      effect: 'signatory_required',
    });
  }

  const income = answers.q_monthly_income;
  if (profile.customerType === 'consumer' && typeof income === 'number') {
    flags.push({
      id: 'income_low',
      questionId: 'q_monthly_income',
      effect: 'rent_cap',
      maxMonthlyRentWithVatCents: Math.floor(
        (income * AFFORDABILITY_NUMERATOR) / AFFORDABILITY_DENOMINATOR
      ),
    });
  }
  return flags;
}
