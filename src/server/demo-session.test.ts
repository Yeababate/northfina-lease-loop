import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake cookie jar standing in for the request's cookies.
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  }),
}));

const { DEMO_NAME_COOKIE, readDemoName, readDemoNameFromRequest } = await import('./demo-session');
const { demoNameCookieHeader } = await import('./demo-cookie');

beforeEach(() => jar.clear());

describe('readDemoName', () => {
  it('is null without a cookie', async () => {
    expect(await readDemoName()).toBeNull();
  });

  it('returns the stored name, cleaned', async () => {
    jar.set(DEMO_NAME_COOKIE, '  Aino  Virtanen ');
    expect(await readDemoName()).toBe('Aino Virtanen');
  });

  it('ignores a stored value that is not a valid name', async () => {
    jar.set(DEMO_NAME_COOKIE, '   ');
    expect(await readDemoName()).toBeNull();
    jar.set(DEMO_NAME_COOKIE, 'x'.repeat(500));
    expect(await readDemoName()).toBeNull();
  });
});

describe('readDemoNameFromRequest', () => {
  const withCookie = (cookie?: string) =>
    new Request('http://localhost/', cookie ? { headers: { cookie } } : {});

  it('reads and cleans the name from the request cookie', () => {
    expect(readDemoNameFromRequest(withCookie(demoNameCookieHeader('  Sanna  Mäkelä ')))).toBe(
      'Sanna Mäkelä'
    );
  });

  it('is null without the cookie or with an invalid name', () => {
    expect(readDemoNameFromRequest(withCookie())).toBeNull();
    expect(readDemoNameFromRequest(withCookie('other=1'))).toBeNull();
    expect(readDemoNameFromRequest(withCookie(demoNameCookieHeader('   ')))).toBeNull();
  });
});
