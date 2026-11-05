// Demo sign-in: the visitor only gives a name, no password (issue #1). These rules decide
// what counts as a name and where the visitor goes before and after giving one.

/** Long enough for "Haapalan Tila Oy, Maija Haapala", short enough for the header. */
export const DEMO_NAME_MAX_LENGTH = 60;

export type DemoNameResult =
  { ok: true; name: string } | { ok: false; reason: 'empty' | 'too_long' };

/**
 * Cleans a typed name: trims it, turns runs of whitespace into one space and drops control
 * characters. Refuses an empty name and one longer than DEMO_NAME_MAX_LENGTH characters.
 */
export function normaliseDemoName(text: string): DemoNameResult {
  const name = text
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name === '') return { ok: false, reason: 'empty' };
  // Count characters, not UTF-16 units, so "Äää" or an emoji counts as one each.
  if ([...name].length > DEMO_NAME_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  return { ok: true, name };
}

/**
 * Where to go after signing in. Only a path on this site is allowed ("/en/items/x?term=36"),
 * never another site ("https://…", "//evil.example") or the sign-in page itself, so the
 * link cannot be used to send people elsewhere.
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback;
  }
  if (/\p{Cc}/u.test(next)) return fallback;
  const path = next.split(/[?#]/)[0] ?? '';
  if (/^\/[a-z]{2}\/sign-in\/?$/.test(path)) return fallback;
  return next;
}

/**
 * Pages that need a name: applying for a lease and signing it. Browsing the catalogue and
 * pricing an item stay open, so nobody has to sign in just to look around.
 */
export function pageNeedsName(pathname: string): boolean {
  const [, , section, , step] = pathname.split('/');
  return section === 'items' && (step === 'apply' || step === 'sign');
}

/**
 * The sign-in address for a page visited without a name, or null when no detour is needed:
 * the visitor has a name, or the page does not need one (see pageNeedsName).
 */
export function signInRedirect(
  pathname: string,
  search: string,
  hasName: boolean,
  locales: readonly string[]
): string | null {
  if (hasName || !pageNeedsName(pathname)) return null;
  const [, locale] = pathname.split('/');
  if (!locale || !locales.includes(locale)) return null;
  const next = new URLSearchParams({ next: `${pathname}${search}` });
  return `/${locale}/sign-in?${next}`;
}
