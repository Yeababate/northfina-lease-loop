import { describe, expect, it } from 'vitest';
import { loadQuestions } from '@/data/load';
import type { AskWhenCondition } from '@/data/schemas';
import { describeAskWhen } from './ask-when-hints';

describe('describeAskWhen', () => {
  it('gives no hints for a question that is always asked', () => {
    expect(describeAskWhen([])).toEqual([]);
  });

  it('describes the data pack: PEP from €10,000, the farm registry for farm machines', async () => {
    const { questions } = await loadQuestions();
    const hints = (id: string) =>
      describeAskWhen(questions.find((question) => question.id === id)?.ask_when ?? []);
    expect(hints('q_pep')).toEqual([{ kind: 'amount', fromCents: 1000000 }]);
    expect(hints('q_farm_registry')).toEqual([{ kind: 'category', categories: ['farm_machine'] }]);
    expect(hints('q_pep_details')).toEqual([
      { kind: 'amount', fromCents: 1000000 },
      { kind: 'answer', questionId: 'q_pep', values: ['yes'] },
    ]);
    expect(hints('q_monthly_income')).toEqual([
      { kind: 'customer_type', types: ['consumer'] },
      { kind: 'amount', fromCents: 200000 },
    ]);
  });

  it('merges a lower and an upper bound into one range, keeping the tighter of each', () => {
    const conditions: AskWhenCondition[] = [
      { field: 'financed_amount_cents', op: 'lte', value: 900000 },
      { field: 'financed_amount_cents', op: 'gte', value: 100000 },
      { field: 'financed_amount_cents', op: 'gte', value: 300000 },
      { field: 'financed_amount_cents', op: 'lte', value: 500000 },
    ];
    expect(describeAskWhen(conditions)).toEqual([
      { kind: 'amount', fromCents: 300000, upToCents: 500000 },
    ]);
  });

  it('describes a term range with only an upper bound', () => {
    expect(describeAskWhen([{ field: 'term_months', op: 'lte', value: 24 }])).toEqual([
      { kind: 'term', upToMonths: 24 },
    ]);
  });

  it('puts hints in a fixed order whatever order the conditions are in', () => {
    const conditions: AskWhenCondition[] = [
      { field: 'answers.q_can_sign', op: 'in', value: ['no'] },
      { field: 'term_months', op: 'gte', value: 36 },
      { field: 'category', op: 'in', value: ['laptop', 'e_bike'] },
      { field: 'customer_type', op: 'in', value: ['company'] },
    ];
    expect(describeAskWhen(conditions).map((hint) => hint.kind)).toEqual([
      'customer_type',
      'category',
      'term',
      'answer',
    ]);
  });

  it('leaves out combinations the engine never matches instead of guessing', () => {
    const conditions: AskWhenCondition[] = [
      { field: 'financed_amount_cents', op: 'in', value: ['1000'] },
      { field: 'customer_type', op: 'gte', value: 1 },
      { field: 'answers.q_pep', op: 'lte', value: 3 },
    ];
    expect(describeAskWhen(conditions)).toEqual([]);
  });
});
