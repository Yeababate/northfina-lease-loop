import { cookies } from 'next/headers';
import { db } from './db';
import { MOCK_USER_COOKIE } from './mock-users';

/** Replace this adapter with proper login later; consumers use stable participant IDs. */
export async function currentPrincipal() {
  const id = (await cookies()).get(MOCK_USER_COOKIE)?.value;
  return id ? db.demoUser.findUnique({ where: { id } }) : null;
}
