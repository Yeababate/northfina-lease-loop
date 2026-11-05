// GET /api/bundles/:id   one bundle (unpublished or blocked ones only for their provider)
// PUT /api/bundles/:id   replace its definition; send the `expectedRevision` you edited
import { loadCoefficientTable } from '@/data/load';
import { availableTerms } from '@/domain/pricing';
import { fail, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { DEMO_PROVIDER_ID, getBundleOffer, updateBundleOffer } from '@/server/bundles';
import { db } from '@/server/db';
import { bundleUpdateSchema } from '../body-schema';

export const GET = handleRoute(async (request, { params }: RouteContext<'/api/bundles/[id]'>) => {
  const { id } = await params;
  const scope = new URL(request.url).searchParams.get('scope');
  const offer = await getBundleOffer(db, id, {
    providerId: scope === 'provider' ? DEMO_PROVIDER_ID : null,
  });
  return offer ? ok(offer) : fail(404, 'BUNDLE_NOT_FOUND', 'Bundle not found');
});

export const PUT = handleRoute(async (request, { params }: RouteContext<'/api/bundles/[id]'>) => {
  const { id } = await params;
  const body = await readJsonBody(request, bundleUpdateSchema);
  const table = await loadCoefficientTable();
  const offer = await updateBundleOffer(db, id, body, {
    providerId: DEMO_PROVIDER_ID,
    supportedTerms: availableTerms(table),
  });
  return ok(offer);
});
