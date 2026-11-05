// The demo visitor's name, kept in a session cookie (issue #1). There is no password and no
// account: the name only personalises the demo. The cookie is HTTP-only, so page scripts
// cannot read it, and it has no expiry, so it ends when the browser closes.
import { cookies } from 'next/headers';
import { normaliseDemoName } from '@/domain/demo-name';
import { DEMO_NAME_COOKIE } from './demo-cookie';

export { DEMO_NAME_COOKIE, DEMO_NAME_COOKIE_OPTIONS } from './demo-cookie';

/** The visitor's name, or null when none is set or the stored one is no longer valid. */
export async function readDemoName(): Promise<string | null> {
  const value = (await cookies()).get(DEMO_NAME_COOKIE)?.value;
  if (value === undefined) return null;
  const result = normaliseDemoName(value);
  return result.ok ? result.name : null;
}
