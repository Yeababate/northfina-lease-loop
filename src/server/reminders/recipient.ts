// Who the reminder inbox and settings belong to: main's replaceable identity seam,
// currentCustomer(). When real sign-in replaces it, only this adapter changes.
import { ApiError } from '../api-response';
import { currentCustomer } from '../current-customer';

export async function requireRecipient(): Promise<string> {
  const customer = await currentCustomer();
  if (!customer) throw new ApiError(401, 'NO_CUSTOMER', 'No customer is selected');
  return customer.id;
}
