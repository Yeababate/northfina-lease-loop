import { beforeAll, describe, expect, it } from 'vitest';
import { loadQuestions } from '@/data/load';
import type { Question } from '@/data/schemas';
import { impliedAnswers, parseProfileKey, type ProfileKey } from './answer-scope';
import {
  answersToRemember,
  canRemember,
  chooseProfileSet,
  customerTypeOf,
  prefillFromProfile,
  profileKeyFromAnswers,
  profileQuestionnaire,
  rememberState,
  sameAnswer,
  savedAnswersOf,
  type RememberedSet,
} from './remembered-answers';

let questions: Question[];
beforeAll(async () => {
  ({ questions } = await loadQuestions());
});

const key = (input: string): ProfileKey => {
  const parsed = parseProfileKey(input);
  if (!parsed) throw new Error(`bad key ${input}`);
  return parsed;
};

const NORVI = 'company:3299871-7';
const KETTU = 'company:3187650-7';
// Most recently changed first, as the API lists them.
const SETS: RememberedSet[] = [
  { profileKey: NORVI, answers: { q_email: 'fleet@norvi.example.com', q_can_sign: 'no' } },
  { profileKey: 'consumer', answers: { q_email: 'aino@example.com', q_country: 'FI' } },
  { profileKey: KETTU, answers: { q_email: 'it@kettukoodi.example.com' } },
];

describe('profileKeyFromAnswers', () => {
  it('keys a person by the customer type', () => {
    expect(profileKeyFromAnswers({ q_customer_type: 'consumer' })?.key).toBe('consumer');
    expect(profileKeyFromAnswers({ q_customer_type: 'sole_trader' })?.key).toBe('sole_trader');
  });
  it('keys a company by its business id, and only a valid one', () => {
    expect(
      profileKeyFromAnswers({ q_customer_type: 'company', q_business_id: '3299871-7' })?.key
    ).toBe(NORVI);
    expect(
      profileKeyFromAnswers({ q_customer_type: 'company', q_business_id: '1234567-8' })
    ).toBeNull();
    expect(profileKeyFromAnswers({ q_customer_type: 'company' })).toBeNull();
  });
  it('has no key before the customer type is known, or for an unknown type', () => {
    expect(profileKeyFromAnswers({})).toBeNull();
    expect(profileKeyFromAnswers({ q_customer_type: 'robot' })).toBeNull();
    expect(customerTypeOf({ q_customer_type: 'robot' })).toBeNull();
  });
});

describe('chooseProfileSet', () => {
  it('picks the newest set while the customer type is not answered, with implied answers', () => {
    expect(chooseProfileSet(SETS, {})).toEqual({
      key: key(NORVI),
      answers: {
        ...SETS[0]?.answers,
        q_customer_type: 'company',
        q_business_id: '3299871-7',
      },
    });
  });
  it('picks the set of the customer type the application has', () => {
    expect(chooseProfileSet(SETS, { q_customer_type: 'consumer' })?.key.key).toBe('consumer');
    expect(chooseProfileSet(SETS, { q_customer_type: 'sole_trader' })).toBeNull();
  });
  it('picks a company by the business id given, else the newest company', () => {
    const kettu = { q_customer_type: 'company', q_business_id: '3187650-7' };
    expect(chooseProfileSet(SETS, kettu)?.key.key).toBe(KETTU);
    expect(chooseProfileSet(SETS, { q_customer_type: 'company' })?.key.key).toBe(NORVI);
    expect(
      chooseProfileSet(SETS, { q_customer_type: 'company', q_business_id: '0000000-0' })
    ).toBeNull();
  });
  it('skips sets whose key no longer parses, and handles no sets', () => {
    const broken: RememberedSet[] = [{ profileKey: 'company:1234567-8', answers: {} }, ...SETS];
    expect(chooseProfileSet(broken, {})?.key.key).toBe(NORVI);
    expect(chooseProfileSet([], {})).toBeNull();
  });
});

describe('prefillFromProfile', () => {
  it('puts the profile under the application answers, which win', () => {
    expect(
      prefillFromProfile(SETS, { q_customer_type: 'consumer', q_email: 'new@example.com' })
    ).toEqual({ q_customer_type: 'consumer', q_email: 'new@example.com', q_country: 'FI' });
  });
  it('leaves the answers alone when no set fits', () => {
    const answers = { q_customer_type: 'sole_trader' };
    expect(prefillFromProfile(SETS, answers)).toBe(answers);
  });
});

describe('sameAnswer', () => {
  it('compares text, money and lists by value', () => {
    expect(sameAnswer('a', 'a')).toBe(true);
    expect(sameAnswer(320000, 320000)).toBe(true);
    expect(sameAnswer(['A', 'B'], ['A', 'B'])).toBe(true);
    expect(sameAnswer(['A', 'B'], ['B', 'A'])).toBe(false);
    expect(sameAnswer(['A'], 'A')).toBe(false);
    expect(sameAnswer('1', 1)).toBe(false);
    expect(sameAnswer(undefined, undefined)).toBe(false);
  });
});

describe('canRemember and rememberState', () => {
  it('never offers the key itself or a deal question', () => {
    expect(canRemember('q_customer_type', null)).toBe(false);
    expect(canRemember('q_business_id', 'company')).toBe(false);
    expect(canRemember('q_business_id', 'sole_trader')).toBe(true);
    expect(canRemember('q_usage_purpose', 'consumer')).toBe(false);
    expect(canRemember('q_unknown', 'consumer')).toBe(false);
    expect(canRemember('q_email', null)).toBe(true);
  });
  it('agrees with the answers a key implies', () => {
    for (const input of ['consumer', 'sole_trader', NORVI]) {
      const profile = key(input);
      for (const id of Object.keys(impliedAnswers(profile))) {
        expect(canRemember(id, profile.customerType), `${input} ${id}`).toBe(false);
      }
    }
  });
  it('says whether the set has this answer, another one or none', () => {
    const consumer = key('consumer');
    const saved = { q_email: 'aino@example.com' };
    expect(rememberState('q_email', 'aino@example.com', consumer, saved)).toBe('saved');
    expect(rememberState('q_email', 'other@example.com', consumer, saved)).toBe('different');
    expect(rememberState('q_country', 'FI', consumer, saved)).toBe('unsaved');
    expect(rememberState('q_country', 'FI', consumer, undefined)).toBe('unsaved');
    expect(rememberState('q_usage_purpose', 'leisure', consumer, saved)).toBe('not_rememberable');
    expect(rememberState('q_email', 'a@b.fi', null, saved)).toBe('not_rememberable');
  });
});

describe('savedAnswersOf', () => {
  it('returns the stored answers of exactly that key', () => {
    expect(savedAnswersOf(SETS, key(KETTU))).toEqual({ q_email: 'it@kettukoodi.example.com' });
    expect(savedAnswersOf(SETS, key('sole_trader'))).toEqual({});
    expect(savedAnswersOf(SETS, null)).toEqual({});
  });
});

describe('answersToRemember', () => {
  it('lists the new and changed answers in question order, parents first', () => {
    const answers = {
      q_signatory_email: 'ceo@norvi.example.com',
      q_customer_type: 'company',
      q_business_id: '3299871-7',
      q_email: 'fleet@norvi.example.com',
      q_can_sign: 'no',
      q_company_name: 'Norvi Logistics Oy',
      q_usage_purpose: 'delivery',
    };
    expect(
      answersToRemember(questions, answers, key(NORVI), { q_email: 'fleet@norvi.example.com' })
    ).toEqual([
      ['q_company_name', 'Norvi Logistics Oy'],
      ['q_can_sign', 'no'],
      ['q_signatory_email', 'ceo@norvi.example.com'],
    ]);
  });
  it('has nothing to save without a key, or when everything is saved', () => {
    expect(answersToRemember(questions, { q_email: 'a@b.fi' }, null, {})).toEqual([]);
    expect(
      answersToRemember(questions, { q_email: 'a@b.fi' }, key('consumer'), { q_email: 'a@b.fi' })
    ).toEqual([]);
  });
});

describe('profileQuestionnaire', () => {
  const ids = (input: string, saved = {}) =>
    profileQuestionnaire(questions, key(input), saved).map((question) => question.id);

  it('asks a consumer every question that could apply to some item', () => {
    expect(ids('consumer')).toEqual([
      'q_full_name',
      'q_birth_date',
      'q_email',
      'q_country',
      'q_employment',
      'q_monthly_income',
      'q_farm_registry',
      'q_pep',
    ]);
  });
  it('shows a follow-up once the answer it depends on is saved', () => {
    expect(ids('consumer', { q_pep: 'yes' })).toContain('q_pep_details');
    expect(ids('consumer', { q_pep: 'no' })).not.toContain('q_pep_details');
  });
  it('asks a company about signing but never for the business id its key already has', () => {
    const company = ids(NORVI);
    expect(company).not.toContain('q_business_id');
    expect(company).not.toContain('q_birth_date');
    expect(company).toEqual(expect.arrayContaining(['q_company_name', 'q_can_sign']));
    expect(company).not.toContain('q_signatory_email');
    expect(ids(NORVI, { q_can_sign: 'no' })).toContain('q_signatory_email');
  });
  it('asks a sole trader for the business id and never asks the deal question', () => {
    expect(ids('sole_trader')).toContain('q_business_id');
    expect(ids('sole_trader')).not.toContain('q_usage_purpose');
    expect(ids('sole_trader')).not.toContain('q_customer_type');
  });
});
