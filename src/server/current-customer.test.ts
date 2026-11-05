import { describe, expect, it } from 'vitest';
import { currentCustomer, DEMO_CUSTOMER_ID, greetingName } from './current-customer';

describe('currentCustomer', () => {
  it('is Aino from scenario card 1 by default', async () => {
    const customer = await currentCustomer();
    expect(customer).toMatchObject({ id: DEMO_CUSTOMER_ID, name: 'Aino Virtanen' });
  });

  it('is null for an unknown id', async () => {
    expect(await currentCustomer('cust-nobody')).toBeNull();
  });
});

describe('greetingName', () => {
  it('uses the first name of a person', async () => {
    const aino = await currentCustomer('cust-aino');
    expect(greetingName(aino!)).toBe('Aino');
    const pekka = await currentCustomer('cust-pekka');
    expect(greetingName(pekka!)).toBe('Pekka');
  });

  it('keeps the full name of a company', async () => {
    const norvi = await currentCustomer('cust-norvi');
    expect(greetingName(norvi!)).toBe('Norvi Logistics Oy');
  });
});
