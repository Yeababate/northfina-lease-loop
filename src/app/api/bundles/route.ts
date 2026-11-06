// GET  /api/bundles                  bookable bundles, for renters
// GET  /api/bundles?scope=provider   all of the provider's bundles, with blocking reasons
// POST /api/bundles                  create a bundle grouping (audited)
// The provider is the demo provider context (provider-session cookie, src/server/providers.ts).
import { z } from 'zod';
import { loadCoefficientTable } from '@/data/load';
import { availableTerms } from '@/domain/pricing';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { createBundleOffer, listBundleOffers } from '@/server/bundles';
import { db } from '@/server/db';
import { requireProvider } from '@/server/providers';
import { bundleBodySchema } from './body-schema';

const querySchema = z.strictObject({ scope: z.enum(['public', 'provider']).default('public') });

export const GET = handleRoute(async (request) => {
  const { scope } = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const offers = await listBundleOffers(
    db,
    scope === 'provider'
      ? { kind: 'provider', providerId: (await requireProvider(db, request)).id }
      : { kind: 'public' }
  );
  return ok(offers);
});

export const POST = handleRoute(async (request) => {
  const provider = await requireProvider(db, request);
  const body = await readJsonBody(request, bundleBodySchema);
  const table = await loadCoefficientTable();
  const offer = await createBundleOffer(db, body, {
    providerId: provider.id,
    supportedTerms: availableTerms(table),
  });
  return ok(offer, { status: 201 });
});
