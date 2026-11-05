import { beforeAll, describe, expect, it } from 'vitest';
import { loadCoefficientTable, loadQuestions } from '@/data/load';
import type { CoefficientTable, Question } from '@/data/schemas';
import type { Answers } from './answer-check';
import {
  checkApplicationForSigning,
  priceLockNote,
  signingOfferKey,
  type SigningOffer,
} from './application-signing';
import { checkBusinessId } from './business-id';
import type { Deal } from './question-flow';

let questions: Question[];
let coefficientTable: CoefficientTable;
beforeAll(async () => {
  ({ questions } = await loadQuestions());
  coefficientTable = await loadCoefficientTable();
});

// Scenario card 1: ebike-003, 36 months, no down payment, starting 5 Nov 2026.
const ebikeDeal: Deal = {
  category: 'e_bike',
  financedAmountCents: 389_000,
  termMonths: 36,
  startDate: '2026-11-05',
};
const aino: Answers = {
  q_customer_type: 'consumer',
  q_full_name: 'Aino Virtanen',
  q_birth_date: '1992-03-14',
  q_email: 'aino@example.com',
  q_country: 'FI',
  q_employment: 'employed',
  q_monthly_income: 320_000,
  q_usage_purpose: 'commuting',
};

/** A business ID with a valid check digit, found by trying each digit: no magic number. */
const validBusinessId = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
  .map((digit) => `1572860-${digit}`)
  .find((candidate) => checkBusinessId(candidate).ok)!;

const company: Answers = {
  q_customer_type: 'company',
  q_email: 'fleet@norvi.example.com',
  q_business_id: validBusinessId,
  q_company_name: 'Norvi Logistics Oy',
  q_can_sign: 'yes',
  q_vat_registered: 'yes',
  q_usage_purpose: 'delivery',
};

const check = (deal: Deal, answers: Answers, monthlyRentWithVatCents = 13_466) =>
  checkApplicationForSigning({
    questions,
    deal,
    answers,
    monthlyRentWithVatCents,
    coefficientTable,
  });

describe('checkApplicationForSigning', () => {
  it('lets an approved consumer sign in their own name', () => {
    expect(check(ebikeDeal, aino)).toEqual({ ok: true, signerName: 'Aino Virtanen' });
  });

  it('trims the name used on the contract', () => {
    expect(check(ebikeDeal, { ...aino, q_full_name: '  Aino Virtanen ' })).toEqual({
      ok: true,
      signerName: 'Aino Virtanen',
    });
  });

  it('refuses an application with questions still open', () => {
    const { q_usage_purpose: _skipped, ...partial } = aino;
    expect(check(ebikeDeal, partial)).toEqual({ ok: false, reason: 'incomplete' });
  });

  it('refuses a declined application: too young (scenario card 5)', () => {
    expect(check(ebikeDeal, { ...aino, q_birth_date: '2009-06-01' })).toEqual({
      ok: false,
      reason: 'not_approved',
    });
  });

  it('refuses when the rent does not fit the income', () => {
    expect(check(ebikeDeal, { ...aino, q_monthly_income: 40_000 })).toEqual({
      ok: false,
      reason: 'not_approved',
    });
  });

  it('refuses an application waiting for manual review', () => {
    const big: Deal = { ...ebikeDeal, financedAmountCents: 1_200_000 };
    expect(
      check(big, { ...aino, q_monthly_income: 900_000, q_pep: 'yes', q_pep_details: 'MP' }, 50_000)
    ).toEqual({ ok: false, reason: 'not_approved' });
  });

  it('lets a company sign in its own name when the applicant may sign', () => {
    expect(check(ebikeDeal, company)).toEqual({ ok: true, signerName: 'Norvi Logistics Oy' });
  });

  it('sends the contract to the signatory when the applicant may not sign (scenario card 6)', () => {
    expect(
      check(ebikeDeal, { ...company, q_can_sign: 'no', q_signatory_email: 'ceo@norvi.example.com' })
    ).toEqual({ ok: false, reason: 'signatory_required', signatoryEmail: 'ceo@norvi.example.com' });
  });
});

describe('priceLockNote', () => {
  it('says nothing changed when the same list applies', () => {
    expect(
      priceLockNote(
        { priceListVersion: 1, monthlyNetCents: 10_730 },
        { priceListVersion: 1, monthlyNetCents: 10_730 }
      )
    ).toEqual({ listChanged: false, direction: 'same', differenceCents: 0 });
  });

  it('explains a cheaper price after the list changed (scenario card 2)', () => {
    expect(
      priceLockNote(
        { priceListVersion: 1, monthlyNetCents: 10_000 },
        { priceListVersion: 2, monthlyNetCents: 9_200 }
      )
    ).toEqual({ listChanged: true, direction: 'lower', differenceCents: 800 });
  });

  it('explains a dearer price, and a new list that kept the price', () => {
    expect(
      priceLockNote(
        { priceListVersion: 1, monthlyNetCents: 10_730 },
        { priceListVersion: 2, monthlyNetCents: 11_267 }
      )
    ).toEqual({ listChanged: true, direction: 'higher', differenceCents: 537 });
    expect(
      priceLockNote(
        { priceListVersion: 1, monthlyNetCents: 50_000 },
        { priceListVersion: 2, monthlyNetCents: 50_000 }
      )
    ).toEqual({ listChanged: true, direction: 'same', differenceCents: 0 });
  });
});

it('requires new consent for every change to the displayed lease offer', () => {
  const offer: SigningOffer = {
    assetId: 'ebike-003',
    termMonths: 36,
    downPaymentCents: 0,
    startOn: '2026-11-05',
    monthlyNetCents: 10730,
    buyoutCents: 58350,
    priceListVersion: 1,
    monthlyGrossCents: 13466,
  };
  const accepted = signingOfferKey(offer);
  expect(signingOfferKey({ ...offer })).toBe(accepted);
  for (const patch of [
    { assetId: 'ebike-004' },
    { termMonths: 24 },
    { downPaymentCents: 10000 },
    { startOn: '2027-01-31' },
    { monthlyNetCents: 10731 },
    { buyoutCents: 58351 },
    { priceListVersion: 2 },
    { monthlyGrossCents: 13520 },
  ])
    expect(signingOfferKey({ ...offer, ...patch })).not.toBe(accepted);
});
