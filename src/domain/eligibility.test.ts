import { beforeAll, describe, expect, it } from 'vitest';
import { loadCoefficientTable, loadQuestions } from '@/data/load';
import type { CoefficientTable, Question } from '@/data/schemas';
import type { Answers } from './answer-check';
import { decideApplication, type Check } from './eligibility';
import { resolveFlow, type Deal, type FlowState } from './question-flow';

let questions: Question[];
let coefficientTable: CoefficientTable;
beforeAll(async () => {
  ({ questions } = await loadQuestions());
  coefficientTable = await loadCoefficientTable();
});

const deal: Deal = {
  category: 'e_bike',
  financedAmountCents: 389_000,
  termMonths: 36,
  startDate: '2026-11-05',
};

const consumer: Answers = {
  q_customer_type: 'consumer',
  q_full_name: 'Aino Virtanen',
  q_birth_date: '1997-04-12',
  q_email: 'aino.virtanen@example.com',
  q_country: 'FI',
  q_employment: 'employed',
  q_monthly_income: 320_000,
  q_usage_purpose: 'commuting',
};

/** Rent with VAT from the data pack's worked example: 10730 net + 2736 VAT. */
const AINO_RENT_WITH_VAT = 13_466;

function decide(answers: Answers, rent = AINO_RENT_WITH_VAT, forDeal: Deal = deal) {
  const flow = resolveFlow(questions, forDeal, answers);
  return decideApplication({
    flow,
    deal: forDeal,
    monthlyRentWithVatCents: rent,
    coefficientTable,
  });
}

const resultOf = (checks: Check[], rule: Check['rule']) =>
  checks.find((check) => check.rule === rule)?.result;

describe('decideApplication', () => {
  it('approves the happy path and lists every rule it checked', () => {
    const decision = decide(consumer);
    expect(decision).toEqual({
      outcome: 'approved',
      reasons: [],
      signatoryEmail: null,
      checks: [
        { rule: 'min_age', result: 'passed' },
        { rule: 'residency', result: 'passed' },
        { rule: 'affordability', result: 'passed' },
        { rule: 'business_id', result: 'not_applicable' },
        { rule: 'pep_manual_review', result: 'not_applicable' },
        { rule: 'financed_limits', result: 'passed' },
      ],
    });
  });

  it('does not decide while questions are still open', () => {
    const { q_country: _country, ...open } = consumer;
    expect(decide(open)).toEqual({ outcome: 'incomplete' });
  });

  it('declines a blocked flow and marks rules it never reached as not checked', () => {
    const decision = decide({ q_customer_type: 'consumer', q_birth_date: '2009-03-10' });
    expect(decision.outcome).toBe('declined');
    if (decision.outcome === 'incomplete') return;
    expect(decision.reasons).toEqual([{ rule: 'min_age', result: 'failed' }]);
    expect(resultOf(decision.checks, 'residency')).toBe('not_checked');
    expect(resultOf(decision.checks, 'affordability')).toBe('not_checked');
  });

  describe('affordability (rent with VAT at most 30 % of net income)', () => {
    // 30 % of 3 200,00 € is exactly 960,00 €.
    it('passes at exactly 30 % and fails one cent above it', () => {
      expect(decide(consumer, 96_000).outcome).toBe('approved');
      const decision = decide(consumer, 96_001);
      expect(decision).toMatchObject({
        outcome: 'declined',
        reasons: [{ rule: 'affordability', result: 'failed', maxMonthlyRentWithVatCents: 96_000 }],
      });
    });

    it('rounds the highest rent that fits down to the cent', () => {
      // 30 % of 900,01 € is 270,003 €, so 270,00 € is the most that fits.
      const decision = decide({ ...consumer, q_monthly_income: 90_001 }, 30_000);
      expect(decision).toMatchObject({
        reasons: [{ rule: 'affordability', maxMonthlyRentWithVatCents: 27_000 }],
      });
    });

    it('does not apply below 2 000 € financed, where income is not asked', () => {
      const small: Deal = { ...deal, financedAmountCents: 150_000 };
      const decision = decide(consumer, 50_000, small);
      expect(decision.outcome).toBe('approved');
      if (decision.outcome === 'incomplete') return;
      expect(resultOf(decision.checks, 'affordability')).toBe('not_applicable');
    });
  });

  describe('politically exposed persons', () => {
    const bigDeal: Deal = { ...deal, financedAmountCents: 1_000_000 };

    it('sends a PEP to manual review, never to an automatic yes', () => {
      const decision = decide(
        { ...consumer, q_pep: 'yes', q_pep_details: 'Member of parliament since 2019' },
        13_466,
        bigDeal
      );
      expect(decision).toMatchObject({
        outcome: 'manual_review',
        reasons: [{ rule: 'pep_manual_review', result: 'review' }],
      });
    });

    it('declines rather than reviews when another rule fails too', () => {
      const decision = decide(
        { ...consumer, q_monthly_income: 40_000, q_pep: 'yes', q_pep_details: 'Mayor since 2020' },
        30_000,
        bigDeal
      );
      expect(decision).toMatchObject({
        outcome: 'declined',
        reasons: [{ rule: 'affordability' }],
      });
    });

    it('passes the PEP rule for a "no"', () => {
      const decision = decide({ ...consumer, q_pep: 'no' }, 13_466, bigDeal);
      expect(decision.outcome).toBe('approved');
    });
  });

  it('approves a company whose applicant cannot sign and names who signs', () => {
    const decision = decide({
      q_customer_type: 'company',
      q_email: 'fleet@norvi.example.com',
      q_business_id: '3299871-7',
      q_company_name: 'Norvi Logistics Oy',
      q_can_sign: 'no',
      q_signatory_email: 'ceo@norvi.example.com',
      q_vat_registered: 'yes',
      q_usage_purpose: 'delivery',
    });
    expect(decision).toMatchObject({
      outcome: 'approved',
      signatoryEmail: 'ceo@norvi.example.com',
    });
  });

  it('declines amounts outside the coefficient table, saying which end', () => {
    expect(decide(consumer, 1_000, { ...deal, financedAmountCents: 29_999 })).toMatchObject({
      outcome: 'declined',
      reasons: [{ rule: 'financed_limits', limit: 'below_minimum' }],
    });
    const huge: Deal = { ...deal, category: 'farm_machine', financedAmountCents: 25_000_001 };
    const farm: Answers = {
      q_customer_type: 'company',
      q_email: 'office@example.com',
      q_business_id: '2876543-5',
      q_company_name: 'Example Farm Oy',
      q_can_sign: 'yes',
      q_vat_registered: 'yes',
      q_farm_registry: '123456789',
      q_annual_revenue: 95_000_000,
      q_beneficial_owners: [],
      q_pep: 'no',
    };
    expect(decide(farm, 0, huge)).toMatchObject({
      outcome: 'declined',
      reasons: [{ rule: 'financed_limits', limit: 'above_maximum' }],
    });
  });

  it('declines a business ID with a wrong check digit if one ever reaches it', () => {
    // The flow keeps invalid IDs out, so build a finished flow by hand.
    const flow: FlowState = {
      status: 'complete',
      next: null,
      block: null,
      answers: { q_customer_type: 'sole_trader', q_business_id: '1234567-8' },
      answered: ['q_customer_type', 'q_business_id'],
      removed: [],
      remaining: 0,
    };
    const decision = decideApplication({
      flow,
      deal,
      monthlyRentWithVatCents: 0,
      coefficientTable,
    });
    expect(decision).toMatchObject({
      outcome: 'declined',
      reasons: [{ rule: 'business_id', result: 'failed' }],
    });
  });

  it('throws on a rent that is not whole cents, because that is a bug in the caller', () => {
    expect(() => decide(consumer, 134.66)).toThrow(RangeError);
  });
});
