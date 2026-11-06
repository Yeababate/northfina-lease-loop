import { beforeAll, describe, expect, it } from 'vitest';
import { loadQuestions } from '@/data/load';
import type { Question } from '@/data/schemas';
import {
  ANSWER_SCOPES,
  impliedAnswers,
  isImpliedByKey,
  isRememberable,
  parseProfileKey,
  pruneProfileAnswers,
  type ProfileKey,
} from './answer-scope';

let questions: Question[];
beforeAll(async () => {
  ({ questions } = await loadQuestions());
});

const key = (input: string): ProfileKey => {
  const parsed = parseProfileKey(input);
  if (!parsed) throw new Error(`bad key ${input}`);
  return parsed;
};

describe('ANSWER_SCOPES', () => {
  it('classifies every question in the data pack, and nothing else', () => {
    expect(Object.keys(ANSWER_SCOPES).sort()).toEqual(questions.map((q) => q.id).sort());
  });

  it('never remembers what the item is for, or an unknown question', () => {
    expect(isRememberable('q_usage_purpose')).toBe(false);
    expect(isRememberable('q_made_up')).toBe(false);
    expect(isRememberable('q_birth_date')).toBe(true);
  });
});

describe('parseProfileKey', () => {
  it('accepts the two person types', () => {
    expect(parseProfileKey('consumer')).toEqual({ customerType: 'consumer', key: 'consumer' });
    expect(parseProfileKey('sole_trader')?.customerType).toBe('sole_trader');
  });

  it('keys a company by a valid business id', () => {
    expect(parseProfileKey('company:3299871-7')).toEqual({
      customerType: 'company',
      businessId: '3299871-7',
      key: 'company:3299871-7',
    });
  });

  it.each(['company', 'company:', 'company:1234567-8', 'company: 3299871-7', 'Consumer', ''])(
    'rejects %j',
    (input) => {
      expect(parseProfileKey(input)).toBeNull();
    }
  );
});

describe('impliedAnswers', () => {
  it('gives the customer type, and the business id for a company', () => {
    expect(impliedAnswers(key('consumer'))).toEqual({ q_customer_type: 'consumer' });
    expect(impliedAnswers(key('company:3299871-7'))).toEqual({
      q_customer_type: 'company',
      q_business_id: '3299871-7',
    });
    expect(isImpliedByKey(key('company:3299871-7'), 'q_business_id')).toBe(true);
    // A sole trader's business id is an ordinary answer.
    expect(isImpliedByKey(key('sole_trader'), 'q_business_id')).toBe(false);
  });
});

describe('pruneProfileAnswers', () => {
  it('drops the signatory email once the applicant can sign after all', () => {
    const company = key('company:3299871-7');
    const before = pruneProfileAnswers(questions, company, {
      q_can_sign: 'no',
      q_signatory_email: 'ceo@norvi.example.com',
    });
    expect(before.removed).toEqual([]);
    const after = pruneProfileAnswers(questions, company, {
      ...before.answers,
      q_can_sign: 'yes',
    });
    expect(after.answers).toEqual({ q_can_sign: 'yes' });
    expect(after.removed).toEqual(['q_signatory_email']);
  });

  it('drops PEP details when the answer becomes no', () => {
    const result = pruneProfileAnswers(questions, key('consumer'), {
      q_pep: 'no',
      q_pep_details: 'Mayor',
    });
    expect(result.removed).toEqual(['q_pep_details']);
  });

  it('keeps answers whose only condition is on the deal (amount, item)', () => {
    const result = pruneProfileAnswers(questions, key('consumer'), {
      q_monthly_income: 320000,
      q_pep: 'yes',
      q_pep_details: 'Mayor',
      q_farm_registry: 'FARM-1',
    });
    expect(result.removed).toEqual([]);
  });

  it('drops answers of another customer type, deal-level, invalid and unknown ones', () => {
    const result = pruneProfileAnswers(questions, key('consumer'), {
      q_company_name: 'Norvi',
      q_usage_purpose: 'commuting',
      q_email: 'not an email',
      q_old_question: 'x',
      q_full_name: 'Aino',
    });
    expect(result.answers).toEqual({ q_full_name: 'Aino' });
    expect(result.removed.sort()).toEqual(
      ['q_company_name', 'q_email', 'q_old_question', 'q_usage_purpose'].sort()
    );
  });

  it('never stores the answers the key implies', () => {
    const result = pruneProfileAnswers(questions, key('company:3299871-7'), {
      q_customer_type: 'company',
      q_business_id: '3299871-7',
    });
    expect(result).toEqual({ answers: {}, removed: [] });
  });
});
