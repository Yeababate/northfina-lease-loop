import { beforeAll, describe, expect, it } from 'vitest';
import { loadQuestions } from '@/data/load';
import type { Question } from '@/data/schemas';
import { parseProfileKey, type ProfileKey } from './answer-scope';
import { birthdayAt, profileFlags } from './profile-flags';

let questions: Question[];
beforeAll(async () => {
  ({ questions } = await loadQuestions());
});

const key = (input: string): ProfileKey => {
  const parsed = parseProfileKey(input);
  if (!parsed) throw new Error(`bad key ${input}`);
  return parsed;
};
const TODAY = '2026-11-05';

describe('birthdayAt', () => {
  it('is the same day N years later', () => {
    expect(birthdayAt('2009-03-10', 18)).toBe('2027-03-10');
  });
  it('moves 29 February to 1 March in a common year, like ageOn', () => {
    expect(birthdayAt('2008-02-29', 18)).toBe('2026-03-01');
    expect(birthdayAt('2008-02-29', 16)).toBe('2024-02-29');
  });
  it('rejects a non-date', () => {
    expect(() => birthdayAt('2008-02-30', 18)).toThrow(RangeError);
  });
});

describe('profileFlags', () => {
  it('has no flags for an ordinary profile with no income saved', () => {
    expect(
      profileFlags(key('consumer'), { q_pep: 'no', q_country: 'FI' }, questions, TODAY)
    ).toEqual([]);
  });

  it('flags a PEP for manual review from the amount q_pep is asked at', () => {
    expect(profileFlags(key('company:2876543-5'), { q_pep: 'yes' }, questions, TODAY)).toEqual([
      { id: 'pep_yes', questionId: 'q_pep', effect: 'manual_review', minFinancedCents: 1000000 },
    ]);
  });

  it('flags Mikko as under 18 until his 18th birthday', () => {
    const flags = profileFlags(key('consumer'), { q_birth_date: '2009-03-10' }, questions, TODAY);
    expect(flags).toEqual([
      {
        id: 'under_18',
        questionId: 'q_birth_date',
        effect: 'declined',
        appliesTo: ['consumer', 'sole_trader'],
        until: '2027-03-10',
      },
    ]);
  });

  it('does not flag someone who turns 18 today', () => {
    expect(profileFlags(key('consumer'), { q_birth_date: '2008-11-05' }, questions, TODAY)).toEqual(
      []
    );
  });

  it('flags an unsupported country for people only', () => {
    expect(
      profileFlags(key('sole_trader'), { q_country: 'other' }, questions, TODAY)
    ).toMatchObject([{ id: 'country_not_supported' }]);
  });

  it('flags a company applicant who cannot sign', () => {
    expect(
      profileFlags(key('company:3299871-7'), { q_can_sign: 'no' }, questions, TODAY)
    ).toMatchObject([{ id: 'cannot_sign_for_company', effect: 'signatory_required' }]);
    expect(profileFlags(key('company:3299871-7'), { q_can_sign: 'yes' }, questions, TODAY)).toEqual(
      []
    );
  });

  it('gives a consumer the highest affordable rent, rounded down', () => {
    expect(profileFlags(key('consumer'), { q_monthly_income: 90001 }, questions, TODAY)).toEqual([
      {
        id: 'income_low',
        questionId: 'q_monthly_income',
        effect: 'rent_cap',
        maxMonthlyRentWithVatCents: 27000,
      },
    ]);
    // A sole trader's income is never asked or checked.
    expect(profileFlags(key('sole_trader'), { q_monthly_income: 1 }, questions, TODAY)).toEqual([]);
  });

  it('ignores answers of the wrong shape', () => {
    expect(
      profileFlags(
        key('consumer'),
        { q_birth_date: 'soon', q_monthly_income: '100' },
        questions,
        TODAY
      )
    ).toEqual([]);
  });
});
