// Scenario cards 5, 6 and 7 from CHALLENGE.md, run on the real data pack. Each test answers
// the questions one at a time, the way the UI will, so it also proves the order they come in.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadCoefficientTable, loadCustomers, loadPriceLists, loadQuestions } from '@/data/load';
import type { CoefficientTable, Customer, PriceList, Question } from '@/data/schemas';
import type { Answers, AnswerValue } from './answer-check';
import { decideApplication } from './eligibility';
import { listPriceOn } from './price-list';
import { resolveFlow, type Deal } from './question-flow';

let questions: Question[];
let coefficientTable: CoefficientTable;
let customers: Customer[];
let priceLists: PriceList[];
beforeAll(async () => {
  ({ questions } = await loadQuestions());
  coefficientTable = await loadCoefficientTable();
  customers = await loadCustomers();
  priceLists = await loadPriceLists();
});

const SIGNED_ON = '2026-11-05';

function customer(id: string): Customer {
  const found = customers.find((c) => c.id === id);
  if (!found) throw new Error(`no customer ${id}`);
  return found;
}

function priceOf(assetId: string): number {
  const price = listPriceOn(priceLists, assetId, SIGNED_ON);
  if (!price.ok) throw new Error(`no price for ${assetId}`);
  return price.priceCents;
}

/** Answers each question the flow offers with `answerFor`, until the flow stops asking. */
function runFlow(deal: Deal, answerFor: (questionId: string) => AnswerValue) {
  let answers: Answers = {};
  const asked: string[] = [];
  let flow = resolveFlow(questions, deal, answers);
  while (flow.next) {
    const id = flow.next.question.id;
    asked.push(id);
    answers = { ...flow.answers, [id]: answerFor(id) };
    flow = resolveFlow(questions, deal, answers);
  }
  return { flow, asked };
}

const yesNo = (value: boolean) => (value ? 'yes' : 'no');

describe('scenario 5: too young', () => {
  it('stops Mikko (17) right after his date of birth and declines on the age rule', () => {
    const mikko = customer('cust-mikko');
    if (mikko.type !== 'consumer') throw new Error('Mikko is a consumer');
    const deal: Deal = {
      category: 'laptop',
      financedAmountCents: priceOf('laptop-008'),
      termMonths: 24,
      startDate: SIGNED_ON,
    };

    const { flow, asked } = runFlow(deal, (id) => {
      const answers: Record<string, AnswerValue> = {
        q_customer_type: 'consumer',
        q_full_name: mikko.name,
        q_birth_date: mikko.birth_date,
      };
      return answers[id] ?? 'unexpected';
    });

    expect(asked).toEqual(['q_customer_type', 'q_full_name', 'q_birth_date']);
    expect(flow.block).toEqual({ questionId: 'q_birth_date', rule: 'age_under' });
    const decision = decideApplication({
      flow,
      deal,
      monthlyRentWithVatCents: 0,
      coefficientTable,
    });
    expect(decision).toMatchObject({
      outcome: 'declined',
      reasons: [{ rule: 'min_age', result: 'failed' }],
    });
  });
});

describe('scenario 6: who can sign?', () => {
  it('asks Norvi for the signatory and sends the contract to that person', () => {
    const norvi = customer('cust-norvi');
    if (norvi.type !== 'company') throw new Error('Norvi is a company');
    const deal: Deal = {
      category: 'e_bike',
      financedAmountCents: 4 * priceOf('ebike-004'),
      termMonths: 36,
      startDate: SIGNED_ON,
    };
    const signatory = 'signatory@norvi.example.com';

    const { flow, asked } = runFlow(deal, (id) => {
      const answers: Record<string, AnswerValue> = {
        q_customer_type: 'company',
        q_email: norvi.email,
        q_business_id: norvi.business_id,
        q_company_name: norvi.name,
        q_can_sign: yesNo(norvi.applicant_can_sign),
        q_signatory_email: signatory,
        q_vat_registered: yesNo(norvi.vat_registered),
        q_usage_purpose: 'delivery',
        q_pep: yesNo(norvi.is_pep),
      };
      return answers[id] ?? 'unexpected';
    });

    // 4 × 5 490 € = 21 960 € financed: over 10 000 €, so the PEP question is asked.
    expect(asked).toEqual([
      'q_customer_type',
      'q_email',
      'q_business_id',
      'q_company_name',
      'q_can_sign',
      'q_signatory_email',
      'q_vat_registered',
      'q_usage_purpose',
      'q_pep',
    ]);
    // Affordability applies only to consumers, so the rent does not matter here.
    const decision = decideApplication({
      flow,
      deal,
      monthlyRentWithVatCents: 0,
      coefficientTable,
    });
    expect(decision).toMatchObject({ outcome: 'approved', signatoryEmail: signatory });
  });
});

describe('scenario 7: big ticket', () => {
  it('asks Haapalan Tila the farm and anti-money-laundering questions and ends in manual review', () => {
    const haapala = customer('cust-haapala');
    if (haapala.type !== 'company') throw new Error('Haapalan Tila is a company');
    const deal: Deal = {
      category: 'farm_machine',
      financedAmountCents: priceOf('farm-002') - 2_000_000,
      termMonths: 48,
      startDate: SIGNED_ON,
    };

    const { flow, asked } = runFlow(deal, (id) => {
      const answers: Record<string, AnswerValue> = {
        q_customer_type: 'company',
        q_email: haapala.email,
        q_business_id: haapala.business_id,
        q_company_name: haapala.name,
        q_can_sign: yesNo(haapala.applicant_can_sign),
        q_vat_registered: yesNo(haapala.vat_registered),
        q_farm_registry: '123456789',
        q_annual_revenue: haapala.annual_revenue_cents,
        q_beneficial_owners: haapala.beneficial_owners ?? [],
        q_pep: yesNo(haapala.is_pep),
        q_pep_details: 'Position and start date as given by the applicant',
      };
      return answers[id] ?? 'unexpected';
    });

    // 145 000 € − 20 000 € down = 125 000 € financed: over 50 000 €, so revenue and owners
    // are asked; a farm machine needs the farm registry; a "yes" to PEP asks for details.
    expect(asked).toEqual([
      'q_customer_type',
      'q_email',
      'q_business_id',
      'q_company_name',
      'q_can_sign',
      'q_vat_registered',
      'q_farm_registry',
      'q_annual_revenue',
      'q_beneficial_owners',
      'q_pep',
      'q_pep_details',
    ]);
    const decision = decideApplication({
      flow,
      deal,
      monthlyRentWithVatCents: 0,
      coefficientTable,
    });
    expect(decision).toMatchObject({
      outcome: 'manual_review',
      reasons: [{ rule: 'pep_manual_review', result: 'review' }],
      signatoryEmail: null,
    });
  });
});
