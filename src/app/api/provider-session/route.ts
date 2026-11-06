// /api/provider-session: choose which demo provider (dealer) context to act in.
// GET → the selected provider or null; POST { providerId } → select; DELETE → clear.
// A mock context switch, not authentication (see src/server/providers.ts).
import { z } from 'zod';
import { fail, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { getProvider, PROVIDER_COOKIE, providerFromRequest } from '@/server/providers';

const schema = z.strictObject({ providerId: z.string().trim().min(1).max(120) });

export const GET = handleRoute(async (request) => ok(await providerFromRequest(db, request)));

export const POST = handleRoute(async (request) => {
  const { providerId } = await readJsonBody(request, schema);
  const provider = await getProvider(db, providerId);
  if (!provider) return fail(404, 'PROVIDER_NOT_FOUND', 'Unknown demo provider');
  const cookie = `${PROVIDER_COOKIE}=${encodeURIComponent(provider.id)}; Path=/; HttpOnly; SameSite=Lax`;
  return ok(provider, { headers: { 'Set-Cookie': cookie } });
});

export const DELETE = handleRoute(async () =>
  ok(null, { headers: { 'Set-Cookie': `${PROVIDER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax` } })
);
