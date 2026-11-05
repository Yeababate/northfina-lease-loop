import { beforeAll, describe, expect, it } from 'vitest';
import { loadQuestions } from '@/data/load';
import type { AskWhenCondition, Question } from '@/data/schemas';
import type { Answers } from './answer-check';
import { conditionHolds, resolveFlow, type Deal } from './question-flow';

let questions: Question[];
beforeAll(async () => {
  ({ questions } = await loadQuestions());
});

// ebike-003 with no down payment, signed on 5 Nov 2026 (scenario card 1).
const ebikeDeal: Deal = {
  category: 'e_bike',
  financedAmountCents: 389_000,
  termMonths: 36,
  startDate: '2026-11-05',
};

const ainoAnswers: Answers = {
  q_customer_type: 'consumer',
  q_full_name: 'Aino Virtanen',
  q_birth_date: '1997-04-12',
  q_email: 'aino.virtanen@example.com',
  q_country: 'FI',
  q_employment: 'employed',
  q_monthly_income: 320_000,
  q_usage_purpose: 'commuting',
};

const companyAnswers: Answers = {
  q_customer_type: 'company',
  q_email: 'fleet@norvi.example.com',
  q_business_id: '3299871-7',
  q_company_name: 'Norvi Logistics Oy',
  q_can_sign: 'no',
  q_signatory_email: 'ceo@norvi.example.com',
  q_vat_registered: 'yes',
  q_usage_purpose: 'delivery',
};

describe('resolveFlow', () => {
  it('starts with "Who is leasing?" and counts only what is already known to apply', () => {
    const flow = resolveFlow(questions, ebikeDeal, {});
    expect(flow.status).toBe('in_progress');
    expect(flow.next?.question.id).toBe('q_customer_type');
    // Known now: customer type, email (always) and the e-bike usage question.
    expect(flow.remaining).toBe(3);
  });

  it('asks a consumer the consumer questions in order and then completes', () => {
    const flow = resolveFlow(questions, ebikeDeal, ainoAnswers);
    expect(flow.status).toBe('complete');
    expect(flow.next).toBeNull();
    expect(flow.answered).toEqual([
      'q_customer_type',
      'q_full_name',
      'q_birth_date',
      'q_email',
      'q_country',
      'q_employment',
      'q_monthly_income',
      'q_usage_purpose',
    ]);
    expect(flow.remaining).toBe(0);
  });

  it('offers the first unanswered question, even when later ones are answered', () => {
    const { q_birth_date: _skipped, ...rest } = ainoAnswers;
    const flow = resolveFlow(questions, ebikeDeal, rest);
    expect(flow.next).toEqual({ question: expect.objectContaining({ id: 'q_birth_date' }) });
    expect(flow.answers.q_usage_purpose).toBe('commuting');
    expect(flow.remaining).toBe(1);
  });

  it('asks for income only from 2 000 € financed (band edge)', () => {
    const below = resolveFlow(
      questions,
      { ...ebikeDeal, financedAmountCents: 199_999 },
      ainoAnswers
    );
    const at = resolveFlow(questions, { ...ebikeDeal, financedAmountCents: 200_000 }, ainoAnswers);
    expect(below.answered).not.toContain('q_monthly_income');
    expect(below.removed).toEqual(['q_monthly_income']);
    expect(at.answered).toContain('q_monthly_income');
  });

  it('drops answers that stop applying when the customer type changes, and says which', () => {
    const switched = resolveFlow(questions, ebikeDeal, {
      ...companyAnswers,
      q_customer_type: 'consumer',
    });
    expect(switched.removed).toEqual([
      'q_business_id',
      'q_company_name',
      'q_can_sign',
      'q_signatory_email',
      'q_vat_registered',
    ]);
    expect(Object.keys(switched.answers)).toEqual([
      'q_customer_type',
      'q_email',
      'q_usage_purpose',
    ]);
    expect(switched.next?.question.id).toBe('q_full_name');
  });

  it('drops the signatory email when "Can you sign?" changes from no to yes', () => {
    const flow = resolveFlow(questions, ebikeDeal, { ...companyAnswers, q_can_sign: 'yes' });
    expect(flow.removed).toEqual(['q_signatory_email']);
    expect(flow.status).toBe('complete');
  });

  it('asks for the signatory email only when the applicant cannot sign', () => {
    const { q_signatory_email: _email, ...rest } = companyAnswers;
    const flow = resolveFlow(questions, ebikeDeal, rest);
    expect(flow.next?.question.id).toBe('q_signatory_email');
  });

  it('keeps an invalid business ID out of the answers and returns it with its problem', () => {
    const flow = resolveFlow(questions, ebikeDeal, {
      ...companyAnswers,
      q_business_id: '1234567-8',
    });
    expect(flow.status).toBe('in_progress');
    expect(flow.next).toEqual({
      question: expect.objectContaining({ id: 'q_business_id' }),
      problem: 'bad_business_id_check_digit',
    });
    expect(flow.answers.q_business_id).toBeUndefined();
    expect(flow.removed).toEqual([]);
  });

  it('stops at once when the applicant is under 18, keeping later answers', () => {
    const flow = resolveFlow(questions, ebikeDeal, { ...ainoAnswers, q_birth_date: '2009-03-10' });
    expect(flow.status).toBe('blocked');
    expect(flow.block).toEqual({ questionId: 'q_birth_date', rule: 'age_under' });
    expect(flow.next).toBeNull();
    expect(flow.remaining).toBe(0);
    expect(flow.answers.q_country).toBe('FI');
  });

  it('checks the age on the contract start date, not on the day of applying', () => {
    const turns18 = { ...ainoAnswers, q_birth_date: '2008-11-06' };
    expect(resolveFlow(questions, ebikeDeal, turns18).status).toBe('blocked');
    expect(resolveFlow(questions, { ...ebikeDeal, startDate: '2026-11-06' }, turns18).status).toBe(
      'complete'
    );
  });

  it('stops for a country outside Finland, Sweden and Estonia', () => {
    const flow = resolveFlow(questions, ebikeDeal, {
      q_customer_type: 'consumer',
      q_country: 'other',
    });
    expect(flow.block).toEqual({ questionId: 'q_country', rule: 'answer_in' });
  });

  it('carries on where it left off once a blocking answer is fixed', () => {
    const blocked = resolveFlow(questions, ebikeDeal, {
      ...ainoAnswers,
      q_birth_date: '2009-03-10',
    });
    const fixed = resolveFlow(questions, ebikeDeal, {
      ...blocked.answers,
      q_birth_date: '1997-04-12',
    });
    expect(fixed.status).toBe('complete');
  });
});

describe('conditionHolds', () => {
  it('compares numbers with lte and never matches an unknown value', () => {
    const shortTerm: AskWhenCondition = { field: 'term_months', op: 'lte', value: 24 };
    expect(conditionHolds(shortTerm, { ...ebikeDeal, termMonths: 24 }, {})).toBe(true);
    expect(conditionHolds(shortTerm, { ...ebikeDeal, termMonths: 36 }, {})).toBe(false);

    const canSign: AskWhenCondition = { field: 'answers.q_can_sign', op: 'in', value: ['no'] };
    expect(conditionHolds(canSign, ebikeDeal, {})).toBe(false);
    const big: AskWhenCondition = { field: 'answers.q_can_sign', op: 'gte', value: 1 };
    expect(conditionHolds(big, ebikeDeal, { q_can_sign: 'no' })).toBe(false);
  });
});
