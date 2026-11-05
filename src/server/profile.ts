import { ApiError } from './api-response';
import { documentIntegrityMatches } from './contract-pdf';
import type { PrismaClient } from './prisma-client';

/** Database scoping applies to lists and direct contract/document lookups alike. */
export async function listParticipantContracts(db: PrismaClient, userId: string) {
  return db.contract.findMany({
    where: { OR: [{ renterId: userId }, { providerId: userId }] },
    include: { lines: true, lifecycle: true },
    orderBy: { id: 'asc' },
  });
}

export async function getParticipantContract(db: PrismaClient, userId: string, id: string) {
  const contract = await db.contract.findFirst({
    where: { id, OR: [{ renterId: userId }, { providerId: userId }] },
    include: { lines: true, lifecycle: true },
  });
  if (!contract) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'Contract not found');
  return contract;
}

export async function getParticipantDocument(db: PrismaClient, userId: string, id: string) {
  await getParticipantContract(db, userId, id);
  const document = await db.contractDocument.findUnique({ where: { contractId: id } });
  if (!document || !documentIntegrityMatches(document))
    throw new ApiError(
      404,
      'DOCUMENT_UNAVAILABLE',
      'The original contract document is unavailable'
    );
  return document;
}
