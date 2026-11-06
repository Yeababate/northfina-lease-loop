// GET /documents/contracts/:id/invoices?locale=fi — the lease's issued monthly invoices as
// one PDF to download. Only the contract's renter and provider can get it.
import { isLocale } from '@/i18n/locales';
import { ApiError } from '@/server/api-response';
import { getAsset } from '@/server/assets';
import { db } from '@/server/db';
import { renderInvoicePdf } from '@/server/invoice-pdf';
import { requirePrincipal } from '@/server/mock-users';
import { getParticipantContract } from '@/server/profile';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [principal, { id }] = await Promise.all([requirePrincipal(db, request), context.params]);
    const contract = await getParticipantContract(db, principal.id, id);
    const invoices = await db.invoice.findMany({
      where: { contractId: id },
      orderBy: { period: 'asc' },
    });
    if (invoices.length === 0) throw new ApiError(404, 'NO_INVOICES', 'No invoices issued');

    const requested = new URL(request.url).searchParams.get('locale') ?? 'en';
    const locale = isLocale(requested) ? requested : 'en';
    const assetIds =
      contract.lines.length > 0 ? contract.lines.map((line) => line.assetId) : [contract.assetId];
    const assets = await Promise.all(assetIds.map((assetId) => getAsset(db, assetId)));
    const itemName = assets
      .map((asset, index) => (asset ? `${asset.make} ${asset.model}` : assetIds[index]))
      .join(' + ');

    const bytes = await renderInvoicePdf({
      contractId: id,
      itemName,
      renterName: contract.actor,
      locale,
      invoices,
    });
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="invoices-${id.replace(/[^a-zA-Z0-9-]/g, '')}.pdf"`,
        'Cache-Control': 'private, no-store',
        'Content-Language': locale,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (!(error instanceof ApiError)) console.error('Invoice PDF delivery failed:', error);
    return new Response(null, {
      status: error instanceof ApiError ? error.status : 500,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}
