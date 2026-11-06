// Readiness of the data-pack personas against real items, priced the way signing prices them.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadAssets,
  loadCoefficientTable,
  loadCustomers,
  loadPriceLists,
  loadQuestions,
  loadVatRates,
} from '@/data/load';
import type {
  Asset,
  CoefficientTable,
  Customer,
  PriceList,
  Question,
  VatRates,
} from '@/data/schemas';
import type { Answers, AnswerValue } from './answer-check';
import { impliedAnswers, parseProfileKey } from './answer-scope';
import { priceContract } from './contract-pricing';
import { leaseReadiness, type ReadinessItem } from './lease-readiness';
import { vatCents, vatRateOn } from './vat';

let questions: Question[];
let table: CoefficientTable;
let customers: Customer[];
let lists: PriceList[];
let vat: VatRates;
let assets: Asset[];
beforeAll(async () => {
  ({ questions } = await loadQuestions());
  [table, customers, lists, vat, assets] = await Promise.all([
    loadCoefficientTable(),
    loadCustomers(),
    loadPriceLists(),
    loadVatRates(),
    loadAssets(),
  ]);
});

const TODAY = '2026-11-05';

/** What a persona would remember on their profile, as application answers. */
function personaAnswers(id: string): Answers {
  const c = customers.find((customer) => customer.id === id);
  if (!c) throw new Error(`no customer ${id}`);
  const a: Record<string, AnswerValue> = { q_email: c.email, q_pep: c.is_pep ? 'yes' : 'no' };
  if (c.type === 'company') {
    Object.assign(
      a,
      impliedAnswers({
        customerType: 'company',
        businessId: c.business_id,
        key: `company:${c.business_id}`,
      })
    );
    a.q_company_name = c.name;
    a.q_can_sign = c.applicant_can_sign ? 'yes' : 'no';
    a.q_vat_registered = c.vat_registered ? 'yes' : 'no';
    a.q_annual_revenue = c.annual_revenue_cents;
    if (c.beneficial_owners) a.q_beneficial_owners = c.beneficial_owners;
    return a;
  }
  Object.assign(a, {
    q_customer_type: c.type,
    q_full_name: c.name,
    q_birth_date: c.birth_date,
    q_country: c.country,
  });
  if (c.type === 'consumer') {
    a.q_employment = c.employment;
    a.q_monthly_income = c.monthly_net_income_cents;
  } else {
    a.q_business_id = c.business_id;
    a.q_vat_registered = c.vat_registered ? 'yes' : 'no';
  }
  return a;
}

function item(assetId: string, termMonths = 36, downPaymentCents = 0): ReadinessItem {
  const asset = assets.find((a) => a.id === assetId);
  if (!asset) throw new Error(`no asset ${assetId}`);
  if (asset.status !== 'available') return { ok: false, problem: 'not_available' };
  const priced = priceContract(lists, table, { assetId, termMonths, downPaymentCents }, TODAY);
  if (!priced.ok) return { ok: false, problem: 'not_priceable' };
  const rate = vatRateOn(vat.rates, TODAY);
  if (!rate.ok) throw new Error('no VAT rate');
  const net = priced.price.monthlyNetCents;
  return {
    ok: true,
    deal: {
      category: asset.category,
      financedAmountCents: priced.price.financedCents,
      termMonths,
      startDate: TODAY,
    },
    monthlyRentWithVatCents: net + vatCents(net, rate.rate.rate_percent),
  };
}

const readiness = (savedAnswers: Answers, readinessItem: ReadinessItem) =>
  leaseReadiness({ savedAnswers, item: readinessItem, questions, coefficientTable: table });

describe('leaseReadiness: personas', () => {
  it('Aino, after saving her profile, can lease ebike-003 straight away', () => {
    const result = readiness(personaAnswers('cust-aino'), item('ebike-003'));
    expect(result.status).toBe('ready');
    expect(result.missing).toEqual({ count: 0, questionIds: [] });
    // What the e-bike is for is asked per lease, never remembered.
    expect(result.dealQuestionIds).toEqual(['q_usage_purpose']);
  });

  it('Mikko (17) is declined on the age rule on every available item', () => {
    const mikko = personaAnswers('cust-mikko');
    const available = assets.filter((a) => a.status === 'available');
    expect(available.length).toBeGreaterThan(5);
    for (const asset of available) {
      const result = readiness(mikko, item(asset.id));
      if (result.status === 'not_leasable') continue;
      expect(result.status, asset.id).toBe('declined');
      expect(result.reasons, asset.id).toContain('min_age');
    }
  });

  it('Haapala is sent to manual review for the tractor, with the farm registry and PEP details still missing', () => {
    const result = readiness(personaAnswers('cust-haapala'), item('farm-002'));
    expect(result.status).toBe('manual_review');
    expect(result.reasons).toEqual(['pep_manual_review']);
    expect(result.missing.questionIds).toEqual(['q_farm_registry', 'q_pep_details']);
  });

  it('Norvi needs a signatory: the email of whoever may sign is missing', () => {
    const result = readiness(personaAnswers('cust-norvi'), item('ebike-004'));
    expect(result.status).toBe('missing');
    expect(result.signatoryRequired).toBe(true);
    expect(result.missing.questionIds).toEqual(['q_signatory_email']);
    const named = readiness(
      { ...personaAnswers('cust-norvi'), q_signatory_email: 'ceo@norvi.example.com' },
      item('ebike-004')
    );
    expect(named.status).toBe('ready');
    expect(named.signatoryRequired).toBe(true);
  });

  it('a PEP sees manual review from €10,000 and ready on cheaper items', () => {
    const pep = { ...personaAnswers('cust-aino'), q_pep: 'yes', q_pep_details: 'City council' };
    expect(readiness(pep, item('ebike-003')).status).toBe('ready');
    const tractor = readiness(pep, item('farm-003'));
    expect(tractor.status).toBe('manual_review');
    expect(tractor.reasons).toEqual(['pep_manual_review']);
  });

  it('Sanna can afford the cargo e-bike over 36 months, but not over 12', () => {
    expect(readiness(personaAnswers('cust-sanna'), item('ebike-004', 36)).status).toBe('ready');
    const result = readiness(personaAnswers('cust-sanna'), item('ebike-004', 12));
    expect(result.status).toBe('declined');
    expect(result.reasons).toEqual(['affordability']);
    expect(result.maxMonthlyRentWithVatCents).toBe(27000);
  });
});

describe('leaseReadiness: edge cases', () => {
  it('signed out: missing, with every question that is already known to apply', () => {
    const result = readiness({}, item('ebike-003'));
    expect(result.status).toBe('missing');
    expect(result.missing.questionIds).toEqual(['q_customer_type', 'q_email']);
  });

  it('a decline already known wins over missing answers', () => {
    const result = readiness(
      { q_customer_type: 'consumer', q_country: 'other' },
      item('ebike-003')
    );
    expect(result.status).toBe('declined');
    expect(result.reasons).toContain('residency');
    expect(result.missing.count).toBeGreaterThan(0);
  });

  it('a reserved or returned item is not leasable, whatever the answers', () => {
    expect(readiness(personaAnswers('cust-aino'), item('ebike-009')).status).toBe('not_leasable');
    expect(readiness(personaAnswers('cust-aino'), item('ebike-007')).itemProblem).toBe(
      'not_available'
    );
  });

  it('a financed amount outside the bands is not leasable', () => {
    const result = readiness(personaAnswers('cust-aino'), {
      ok: true,
      deal: { category: 'laptop', financedAmountCents: 100, termMonths: 12, startDate: TODAY },
      monthlyRentWithVatCents: 10,
    });
    expect(result).toMatchObject({ status: 'not_leasable', itemProblem: 'financed_limits' });
  });

  it('ignores a remembered deal-level answer and an invalid one', () => {
    const answers = {
      ...personaAnswers('cust-aino'),
      q_usage_purpose: 'delivery',
      q_email: 'nope',
    };
    const result = readiness(answers, item('ebike-003'));
    expect(result.status).toBe('missing');
    expect(result.missing.questionIds).toEqual(['q_email']);
    expect(result.dealQuestionIds).toEqual(['q_usage_purpose']);
  });

  it('works with a profile key parsed from the API', () => {
    const key = parseProfileKey('company:3299871-7');
    expect(key).not.toBeNull();
    if (key)
      expect(impliedAnswers(key)).toEqual({
        q_customer_type: 'company',
        q_business_id: '3299871-7',
      });
  });
});
