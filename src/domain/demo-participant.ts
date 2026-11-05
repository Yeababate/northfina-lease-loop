// The demo participant behind a sign-in name (issues #1 and #5). The visitor types a name
// on the sign-in page; that name, cleaned by normaliseDemoName, is the only identity. A
// stable DemoUser row is found by its canonical username, so contracts, ratings and other
// records point at an ID, never at free text.
import { normaliseDemoName, type DemoNameResult } from './demo-name';

export type DemoParticipantName =
  | { ok: true; canonicalUsername: string; displayName: string }
  | { ok: false; reason: Extract<DemoNameResult, { ok: false }>['reason'] };

/**
 * The canonical username for a typed or stored sign-in name. The rule, in order:
 * 1. normaliseDemoName: control characters become spaces, whitespace runs become one
 *    space, the ends are trimmed, and empty or over-long names are refused;
 * 2. Unicode NFKC, so full-width "ＡＩＮＯ" and "AINO" are the same name;
 * 3. whitespace is collapsed again (NFKC can produce spaces) and the result lower-cased.
 * "  AINO " and "aino" are one participant; the display name keeps the cleaned spelling.
 */
export function demoParticipantName(text: string): DemoParticipantName {
  const cleaned = normaliseDemoName(text);
  if (!cleaned.ok) return cleaned;
  const canonicalUsername = cleaned.name
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return { ok: true, canonicalUsername, displayName: cleaned.name };
}

/**
 * One cookie's value from a Cookie request header, decoded the way Next.js decodes request
 * cookies. Null when the cookie is missing, empty or not valid percent-encoding.
 */
export function cookieValue(header: string | null, cookieName: string): string | null {
  if (!header) return null;
  let found: string | null = null;
  for (const pair of header.split(/; */)) {
    const splitAt = pair.indexOf('=');
    if (splitAt === -1 || pair.slice(0, splitAt) !== cookieName) continue;
    try {
      found = decodeURIComponent(pair.slice(splitAt + 1));
    } catch {
      found = null;
    }
  }
  return found ? found : null;
}
