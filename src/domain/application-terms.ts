import type { AssetCategory } from '@/data/schemas';
import type { Answers } from './answer-check';

export type UsagePurpose = 'commuting' | 'leisure' | 'delivery';

/** Keep only terms that apply to this customer and item, never stale hidden answers. */
export function applicationTerms(answers: Answers, category: AssetCategory) {
  const purpose = answers.q_usage_purpose;
  const usagePurpose: UsagePurpose | null =
    category === 'e_bike' &&
    (purpose === 'commuting' || purpose === 'leisure' || purpose === 'delivery')
      ? purpose
      : null;
  const business =
    answers.q_customer_type === 'company' || answers.q_customer_type === 'sole_trader';
  const vatRegistered =
    business && (answers.q_vat_registered === 'yes' || answers.q_vat_registered === 'no')
      ? answers.q_vat_registered === 'yes'
      : null;
  return { usagePurpose, vatRegistered };
}

/** Display preference only: VAT is still charged for registered businesses. */
export function priceBasis(answers: Answers): 'net' | 'gross' {
  return applicationTerms(answers, 'laptop').vatRegistered === true ? 'net' : 'gross';
}

/** Measured condition and mileage determine value; no delivery surcharge is invented. */
export function returnCheckFocus(purpose: string | null): 'delivery_wear' | 'standard' {
  return purpose === 'delivery' ? 'delivery_wear' : 'standard';
}
