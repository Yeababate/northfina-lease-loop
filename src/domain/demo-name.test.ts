import { describe, expect, it } from 'vitest';
import {
  DEMO_NAME_MAX_LENGTH,
  normaliseDemoName,
  pageNeedsName,
  safeNextPath,
  signInRedirect,
} from './demo-name';

const locales = ['en', 'fi', 'sv', 'et'];

describe('normaliseDemoName', () => {
  it('trims and collapses whitespace', () => {
    expect(normaliseDemoName('  Aino   Virtanen ')).toEqual({ ok: true, name: 'Aino Virtanen' });
    expect(normaliseDemoName('Aino\tVirtanen\n')).toEqual({ ok: true, name: 'Aino Virtanen' });
  });

  it('keeps letters from every language', () => {
    expect(normaliseDemoName('Sanna Mäkelä')).toEqual({ ok: true, name: 'Sanna Mäkelä' });
    expect(normaliseDemoName('Jüri Õunapuu')).toEqual({ ok: true, name: 'Jüri Õunapuu' });
  });

  it('drops control characters', () => {
    expect(normaliseDemoName('Aino\u0000\u0007 V')).toEqual({ ok: true, name: 'Aino V' });
  });

  it('refuses an empty name, including only spaces', () => {
    expect(normaliseDemoName('')).toEqual({ ok: false, reason: 'empty' });
    expect(normaliseDemoName('   \n ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('allows exactly the maximum length and refuses one character more', () => {
    expect(normaliseDemoName('a'.repeat(DEMO_NAME_MAX_LENGTH))).toMatchObject({ ok: true });
    expect(normaliseDemoName('a'.repeat(DEMO_NAME_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: 'too_long',
    });
  });

  it('counts characters, not code units', () => {
    expect(normaliseDemoName('😀'.repeat(DEMO_NAME_MAX_LENGTH))).toMatchObject({ ok: true });
  });
});

describe('safeNextPath', () => {
  it('keeps a path on this site, with its query', () => {
    expect(safeNextPath('/en/items/ebike-003?term=36', '/en')).toBe('/en/items/ebike-003?term=36');
  });

  it('falls back for missing or empty values', () => {
    expect(safeNextPath(null, '/en')).toBe('/en');
    expect(safeNextPath(undefined, '/en')).toBe('/en');
    expect(safeNextPath('', '/en')).toBe('/en');
  });

  it('never sends people to another site', () => {
    for (const next of [
      'https://evil.example',
      '//evil.example/x',
      '/\\evil.example',
      'javascript:alert(1)',
      'en/items',
      '/en\u0000/x',
    ]) {
      expect(safeNextPath(next, '/en'), next).toBe('/en');
    }
  });

  it('does not loop back to the sign-in page', () => {
    expect(safeNextPath('/fi/sign-in', '/fi')).toBe('/fi');
    expect(safeNextPath('/fi/sign-in/?next=/fi', '/fi')).toBe('/fi');
  });
});

describe('pageNeedsName', () => {
  it('asks for a name when applying or signing', () => {
    expect(pageNeedsName('/en/items/ebike-003/apply')).toBe(true);
    expect(pageNeedsName('/fi/items/laptop-004/sign')).toBe(true);
  });

  it('keeps browsing and pricing open', () => {
    expect(pageNeedsName('/en')).toBe(false);
    expect(pageNeedsName('/en/items/ebike-003')).toBe(false);
    expect(pageNeedsName('/en/sign-in')).toBe(false);
    expect(pageNeedsName('/en/contracts/abc')).toBe(false);
  });
});

describe('signInRedirect', () => {
  it('sends a visitor without a name to sign in, remembering the page', () => {
    expect(signInRedirect('/en/items/ebike-003/apply', '?term=36', false, locales)).toBe(
      '/en/sign-in?next=%2Fen%2Fitems%2Febike-003%2Fapply%3Fterm%3D36'
    );
  });

  it('keeps the language of the page', () => {
    expect(signInRedirect('/fi/items/x/sign', '', false, locales)).toBe(
      '/fi/sign-in?next=%2Ffi%2Fitems%2Fx%2Fsign'
    );
  });

  it('lets a visitor with a name through', () => {
    expect(signInRedirect('/en/items/ebike-003/apply', '', true, locales)).toBeNull();
  });

  it('never redirects open pages or paths outside the app', () => {
    expect(signInRedirect('/en', '', false, locales)).toBeNull();
    expect(signInRedirect('/en/items/ebike-003', '?term=36', false, locales)).toBeNull();
    expect(signInRedirect('/de/items/x/apply', '', false, locales)).toBeNull();
  });
});
