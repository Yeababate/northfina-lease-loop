// What must be true before a contract can be signed, and how to explain the locked price.
// The server runs checkApplicationForSigning on the answers it receives; it never trusts a
// decision the browser computed.
import type { CoefficientTable, Question } from '@/data/schemas';
import type { Answers } from './answer-check';
import { decideApplication } from './eligibility';
import { resolveFlow, type Deal } from './question-flow';

export type SigningCheck =
  | { ok: true; signerName: string }
  | {
      ok: false;
      /**
       * `incomplete`: questions are still open. `not_approved`: declined or manual review.
       * `signatory_required`: approved, but only the company's signatory may sign.
       */
      reason: 'incomplete' | 'not_approved' | 'signatory_required';
      signatoryEmail?: string;
    };

export type SigningCheckInput = {
  questions: readonly Question[];
  deal: Deal;
  answers: Answers;
  /** Monthly rent with VAT, as priced on the signing day. */
  monthlyRentWithVatCents: number;
  coefficientTable: CoefficientTable;
};

/** Re-runs the whole application and allows signing only for an approved one. */
export function checkApplicationForSigning(input: SigningCheckInput): SigningCheck {
  const flow = resolveFlow(input.questions, input.deal, input.answers);
  const decision = decideApplication({
    flow,
    deal: input.deal,
    monthlyRentWithVatCents: input.monthlyRentWithVatCents,
    coefficientTable: input.coefficientTable,
  });
  if (decision.outcome === 'incomplete') return { ok: false, reason: 'incomplete' };
  if (decision.outcome !== 'approved') return { ok: false, reason: 'not_approved' };
  if (decision.signatoryEmail) {
    return { ok: false, reason: 'signatory_required', signatoryEmail: decision.signatoryEmail };
  }

  // The contract is made in the person's name, or the company's for a company.
  const name = flow.answers.q_full_name ?? flow.answers.q_company_name;
  if (typeof name !== 'string' || name.trim() === '') return { ok: false, reason: 'incomplete' };
  return { ok: true, signerName: name.trim() };
}

export type PriceLockNote = {
  /** True when the price list changed between the quote and the signing day. */
  listChanged: boolean;
  /** How the locked monthly net rent compares with the quoted one. */
  direction: 'same' | 'lower' | 'higher';
  /** Absolute difference in monthly net rent, in cents. */
  differenceCents: number;
};

/**
 * Compares the quote the customer saw with the price that locks on signing. The price list
 * valid on the signing day always applies (see contract-pricing.ts); this says whether
 * that changed anything, so the page can explain it.
 */
export function priceLockNote(
  quoted: { priceListVersion: number; monthlyNetCents: number },
  locked: { priceListVersion: number; monthlyNetCents: number }
): PriceLockNote {
  const difference = locked.monthlyNetCents - quoted.monthlyNetCents;
  return {
    listChanged: quoted.priceListVersion !== locked.priceListVersion,
    direction: difference === 0 ? 'same' : difference < 0 ? 'lower' : 'higher',
    differenceCents: Math.abs(difference),
  };
}
