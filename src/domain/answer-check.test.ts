import { beforeAll, describe, expect, it } from 'vitest';
import { loadQuestions } from '@/data/load';
import type { Question } from '@/data/schemas';
import { checkAnswer } from './answer-check';

let byId: (id: string) => Question;
beforeAll(async () => {
  const { questions } = await loadQuestions();
  byId = (id) => {
    const question = questions.find((q) => q.id === id);
    if (!question) throw new Error(`no question ${id} in data/questions.json`);
    return question;
  };
});

describe('checkAnswer', () => {
  it('treats a missing answer as empty for every question type', () => {
    for (const id of ['q_customer_type', 'q_full_name', 'q_email', 'q_birth_date']) {
      expect(checkAnswer(byId(id), undefined)).toEqual({ ok: false, problem: 'empty' });
    }
  });

  it('accepts only listed options for choice questions', () => {
    expect(checkAnswer(byId('q_customer_type'), 'company')).toEqual({ ok: true });
    expect(checkAnswer(byId('q_customer_type'), 'charity')).toEqual({
      ok: false,
      problem: 'not_an_option',
    });
    expect(checkAnswer(byId('q_customer_type'), '')).toEqual({ ok: false, problem: 'empty' });
  });

  it('needs non-blank text', () => {
    expect(checkAnswer(byId('q_full_name'), 'Aino Virtanen')).toEqual({ ok: true });
    expect(checkAnswer(byId('q_full_name'), '   ')).toEqual({ ok: false, problem: 'empty' });
  });

  it('checks the business ID format and check digit, so a typo can be fixed in place', () => {
    const question = byId('q_business_id');
    expect(checkAnswer(question, '3299871-7')).toEqual({ ok: true });
    expect(checkAnswer(question, '1234567-8')).toEqual({
      ok: false,
      problem: 'bad_business_id_check_digit',
    });
    expect(checkAnswer(question, '32998717')).toEqual({
      ok: false,
      problem: 'bad_business_id_format',
    });
  });

  it('checks email addresses loosely', () => {
    expect(checkAnswer(byId('q_email'), 'aino.virtanen@example.com')).toEqual({ ok: true });
    expect(checkAnswer(byId('q_email'), 'aino@example')).toEqual({
      ok: false,
      problem: 'bad_email',
    });
  });

  it('needs real calendar dates', () => {
    expect(checkAnswer(byId('q_birth_date'), '1997-04-12')).toEqual({ ok: true });
    expect(checkAnswer(byId('q_birth_date'), '1997-02-30')).toEqual({
      ok: false,
      problem: 'bad_date',
    });
  });

  it('needs money as whole, non-negative cents', () => {
    const income = byId('q_monthly_income');
    expect(checkAnswer(income, 320_000)).toEqual({ ok: true });
    expect(checkAnswer(income, 0)).toEqual({ ok: true });
    for (const bad of [-1, 3200.5, '3200']) {
      expect(checkAnswer(income, bad)).toEqual({ ok: false, problem: 'bad_money' });
    }
  });

  it('accepts a list of names, including an empty one, but no blank names', () => {
    const owners = byId('q_beneficial_owners');
    expect(checkAnswer(owners, ['Jussi Haapala (60 %)', 'Maria Haapala (40 %)'])).toEqual({
      ok: true,
    });
    expect(checkAnswer(owners, [])).toEqual({ ok: true });
    expect(checkAnswer(owners, ['Jussi', ' '])).toEqual({ ok: false, problem: 'bad_list' });
    expect(checkAnswer(owners, 'Jussi')).toEqual({ ok: false, problem: 'bad_list' });
  });
});
