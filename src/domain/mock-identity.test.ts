import { describe, expect, it } from 'vitest';
import { mockUserIdFromCookie, normalizeMockUsername } from './mock-identity';

describe('mock identity selection', () => {
  it('normalizes case/whitespace without losing the display name', () => {
    expect(normalizeMockUsername('  Aino  ')).toEqual({
      ok: true,
      canonicalUsername: 'aino',
      displayName: 'Aino',
    });
    expect(normalizeMockUsername('ＡＩＮＯ')).toMatchObject({ canonicalUsername: 'aino' });
  });
  it('rejects empty and excessive names', () => {
    expect(normalizeMockUsername('  ')).toEqual({ ok: false, reason: 'empty_username' });
    expect(normalizeMockUsername('a'.repeat(81))).toMatchObject({ ok: false });
  });
  it('reads only the exact cookie and handles malformed encoding', () => {
    expect(mockUserIdFromCookie('theme=dark; lease-loop-user=demo%3Aaino')).toBe('demo:aino');
    expect(mockUserIdFromCookie('other-lease-loop-user=x')).toBeNull();
    expect(mockUserIdFromCookie('lease-loop-user=%')).toBeNull();
    expect(mockUserIdFromCookie(null)).toBeNull();
    expect(mockUserIdFromCookie('lease-loop-user=')).toBeNull();
    expect(mockUserIdFromCookie('lease-loop-user=' + 'a'.repeat(121))).toBeNull();
  });
});
