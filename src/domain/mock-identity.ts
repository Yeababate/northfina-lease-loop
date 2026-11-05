export type MockUsername =
  | { ok: true; canonicalUsername: string; displayName: string }
  | { ok: false; reason: 'empty_username' | 'username_too_long' };

/** Display names never serve as database relationship keys. */
export function normalizeMockUsername(value: string): MockUsername {
  const displayName = value.normalize('NFKC').trim();
  if (!displayName) return { ok: false, reason: 'empty_username' };
  if (displayName.length > 80) return { ok: false, reason: 'username_too_long' };
  return { ok: true, canonicalUsername: displayName.toLowerCase(), displayName };
}

/** Decode only the named mock cookie; malformed input means no selection. */
export function mockUserIdFromCookie(header: string | null): string | null {
  const value = header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('lease-loop-user='));
  if (!value) return null;
  try {
    const id = decodeURIComponent(value.slice('lease-loop-user='.length));
    return id && id.length <= 120 ? id : null;
  } catch {
    return null;
  }
}
