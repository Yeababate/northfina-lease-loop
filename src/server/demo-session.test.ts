import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake cookie jar standing in for the request's cookies.
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  }),
}));

const { DEMO_NAME_COOKIE, readDemoName } = await import('./demo-session');

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
