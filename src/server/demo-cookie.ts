// The demo name cookie's name and options, without any Next.js imports, so the proxy
// (src/proxy.ts) and the server code can share them.

export const DEMO_NAME_COOKIE = 'lease-loop-name';

/** HTTP-only so page scripts cannot read it; no expiry, so it ends with the browser session. */
export const DEMO_NAME_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
} as const;
