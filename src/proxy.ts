// Next.js 16 "proxy" (it was called middleware before Next 16). It runs before routing.
//   - The bare root URL goes to the default language: `/` → `/en`.
//   - A visitor without a demo name goes to the sign-in screen first, and comes back to the
//     page they asked for afterwards (issue #1). The rules are in src/domain/demo-name.ts.
// Picking the language from the Accept-Language header would also go here.
import { NextResponse, type NextRequest } from 'next/server';
import { normaliseDemoName, signInRedirect } from '@/domain/demo-name';
import { defaultLocale, locales } from '@/i18n/locales';
import { DEMO_NAME_COOKIE } from '@/server/demo-cookie';

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === '/') {
    return NextResponse.redirect(new URL(`/${defaultLocale}`, request.url));
  }
  const hasName = normaliseDemoName(request.cookies.get(DEMO_NAME_COOKIE)?.value ?? '').ok;
  const target = signInRedirect(pathname, search, hasName, locales);
  return target ? NextResponse.redirect(new URL(target, request.url)) : NextResponse.next();
}

export const config = {
  // Pages only: not the API, Next's own files, or anything with a file extension (icons).
  matcher: ['/((?!api|_next/static|_next/image|.*\\..*).*)'],
};
