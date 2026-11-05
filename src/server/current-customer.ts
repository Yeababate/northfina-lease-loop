// Who is using the app. There is no sign-in in this hackathon build, so every visitor is the
// demo customer from scenario card 1. Replace this module when real sign-in arrives; pages
// only ever ask `currentCustomer()`, so nothing else has to change.
import { loadCustomers } from '@/data/load';
import type { Customer } from '@/data/schemas';

export const DEMO_CUSTOMER_ID = 'cust-aino';

/** The signed-in customer, or null if the demo customer is missing from the data pack. */
export async function currentCustomer(
  customerId: string = DEMO_CUSTOMER_ID
): Promise<Customer | null> {
  const customers = await loadCustomers();
  return customers.find((customer) => customer.id === customerId) ?? null;
}

/** "Aino Virtanen" → "Aino". Companies keep their full name. */
export function greetingName(customer: Customer): string {
  if (customer.type === 'company') return customer.name;
  return customer.name.split(' ')[0] ?? customer.name;
}
