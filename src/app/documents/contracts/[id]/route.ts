import { getParticipantDocument } from '@/server/profile';
import { requirePrincipal } from '@/server/mock-users';
import { db } from '@/server/db';
import { ApiError } from '@/server/api-response';

/** Binary document delivery is outside /api; JSON endpoints retain their envelope. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [principal, { id }] = await Promise.all([requirePrincipal(db, request), context.params]);
    const document = await getParticipantDocument(db, principal.id, id);
    return new Response(new Uint8Array(document.bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="contract-${id.replace(/[^a-zA-Z0-9-]/g, '')}.pdf"`,
        'Cache-Control': 'private, no-store',
        'Content-Language': document.locale,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (!(error instanceof ApiError)) console.error('Contract document delivery failed:', error);
    return new Response(null, {
      status: error instanceof ApiError ? error.status : 500,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}
