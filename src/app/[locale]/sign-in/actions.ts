'use server';

// Demo sign-in and sign-out (issue #1). Setting a cookie is not a change to business data,
// so there is no audit row; the name is only used to personalise the demo.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { normaliseDemoName, safeNextPath } from '@/domain/demo-name';
import { defaultLocale, isLocale } from '@/i18n/locales';
import { DEMO_NAME_COOKIE, DEMO_NAME_COOKIE_OPTIONS } from '@/server/demo-cookie';

export type SignInState = { problem: 'empty' | 'too_long' | null; name: string };

function localeFrom(formData: FormData) {
  const locale = String(formData.get('locale') ?? '');
  return isLocale(locale) ? locale : defaultLocale;
}

/** Stores the name and continues to the page the visitor came for. */
export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const typed = String(formData.get('name') ?? '');
  const result = normaliseDemoName(typed);
  if (!result.ok) return { problem: result.reason, name: typed };

  (await cookies()).set(DEMO_NAME_COOKIE, result.name, DEMO_NAME_COOKIE_OPTIONS);
  const locale = localeFrom(formData);
  redirect(safeNextPath(String(formData.get('next') ?? ''), `/${locale}`));
}

/** Forgets the name and goes back to the sign-in screen. */
export async function signOut(formData: FormData): Promise<void> {
  (await cookies()).delete(DEMO_NAME_COOKIE);
  redirect(`/${localeFrom(formData)}/sign-in`);
}
