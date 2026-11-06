import { expect, it } from 'vitest';
import { applicationTerms, priceBasis, returnCheckFocus } from './application-terms';

it('keeps delivery use only for bikes', () => {
  expect(applicationTerms({ q_usage_purpose: 'delivery' }, 'e_bike').usagePurpose).toBe('delivery');
  expect(applicationTerms({ q_usage_purpose: 'delivery' }, 'laptop').usagePurpose).toBeNull();
  expect(applicationTerms({ q_usage_purpose: 'unknown' }, 'e_bike').usagePurpose).toBeNull();
  expect(returnCheckFocus('delivery')).toBe('delivery_wear');
  expect(returnCheckFocus('leisure')).toBe('standard');
  expect(returnCheckFocus(null)).toBe('standard');
});

it('uses gross for consumers and unregistered businesses, net for registered businesses', () => {
  expect(priceBasis({})).toBe('gross');
  expect(priceBasis({ q_customer_type: 'consumer', q_vat_registered: 'yes' })).toBe('gross');
  for (const type of ['company', 'sole_trader']) {
    expect(priceBasis({ q_customer_type: type, q_vat_registered: 'yes' })).toBe('net');
    expect(priceBasis({ q_customer_type: type, q_vat_registered: 'no' })).toBe('gross');
    expect(applicationTerms({ q_customer_type: type }, 'e_bike').vatRegistered).toBeNull();
  }
});
