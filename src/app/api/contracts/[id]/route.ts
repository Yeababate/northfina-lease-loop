import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { requirePrincipal } from '@/server/mock-users';
import { getParticipantContract } from '@/server/profile';

export const GET = handleRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const [principal, { id }] = await Promise.all([requirePrincipal(db, request), context.params]);
  const contract = await getParticipantContract(db, principal.id, id);
  const document = await db.contractDocument.findUnique({
    where: { contractId: id },
    select: { locale: true, generatedAt: true, templateVersion: true, sha256: true },
  });
  return ok(
    { contract, document: document ? { ...document, href: `/documents/contracts/${id}` } : null },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
});
