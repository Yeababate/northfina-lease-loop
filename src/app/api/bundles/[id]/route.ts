// GET /api/bundles/:id   one bundle (unpublished or blocked ones only for their provider)
// PUT /api/bundles/:id   replace its definition; send the `expectedRevision` you edited
import { loadCoefficientTable } from '@/data/load';
import { availableTerms } from '@/domain/pricing';
import { fail, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { getBundleOffer, updateBundleOffer } from '@/server/bundles';
import { db } from '@/server/db';
import { providerFromRequest, requireProvider } from '@/server/providers';
import { bundleUpdateSchema } from '../body-schema';

export const GET = handleRoute(async (request, { params }: RouteContext<'/api/bundles/[id]'>) => {
  const { id } = await params;
  const scope = new URL(request.url).searchParams.get('scope');
  const offer = await getBundleOffer(db, id, {
    providerId:
      scope === 'provider' ? ((await providerFromRequest(db, request))?.id ?? null) : null,
  });
  return offer ? ok(offer) : fail(404, 'BUNDLE_NOT_FOUND', 'Bundle not found');
});

export const PUT = handleRoute(async (request, { params }: RouteContext<'/api/bundles/[id]'>) => {
  const { id } = await params;
  const provider = await requireProvider(db, request);
  const body = await readJsonBody(request, bundleUpdateSchema);
  const table = await loadCoefficientTable();
  const offer = await updateBundleOffer(db, id, body, {
    providerId: provider.id,
    supportedTerms: availableTerms(table),
  });
  return ok(offer);
});
