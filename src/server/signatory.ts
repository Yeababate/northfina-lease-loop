// Card 6: the company's signatory signs a contract the applicant sent them. Until then the
// contract is reserved and priced but not active (src/domain/signatory.ts). Signing makes it
// active from that day, audited; nothing else about the locked price changes.
import { AWAITING_SIGNATURE, checkSignatorySignature, isNamedSignatory } from '@/domain/signatory';
import { ApiError } from './api-response';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';

type Signer = { id: string; canonicalUsername: string };

/** A contract the signed-in person may see as its named signatory, or null. */
export async function contractForSignatory(db: PrismaClient, signer: Signer, contractId: string) {
  const contract = await db.contract.findUnique({
    where: { id: contractId },
    include: { lines: true, lifecycle: true },
  });
  return contract && isNamedSignatory(contract.signatoryEmail, signer.canonicalUsername)
    ? contract
    : null;
}

export async function signAsSignatory(
  db: PrismaClient,
  signer: Signer,
  contractId: string,
  today: string
) {
  const contract = await contractForSignatory(db, signer, contractId);
  if (!contract) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'Contract not found');
  const check = checkSignatorySignature(
    { status: contract.lifecycle?.status ?? 'active', signatoryEmail: contract.signatoryEmail },
    signer.canonicalUsername
  );
  if (!check.ok)
    throw new ApiError(409, 'NOT_WAITING_FOR_SIGNATURE', 'This contract is not waiting for you');
  return withAudit(
    db,
    {
      actor: signer.id,
      action: 'contract.signatory_signed',
      entityType: 'contract',
      entityId: contractId,
      details: { signatoryEmail: contract.signatoryEmail, signedOn: today },
    },
    async (tx) => {
      // Guarded: a second click or a race changes nothing.
      const activated = await tx.contractLifecycle.updateMany({
        where: { contractId, status: AWAITING_SIGNATURE },
        data: { status: 'active', revision: { increment: 1 } },
      });
      if (activated.count !== 1)
        throw new ApiError(
          409,
          'NOT_WAITING_FOR_SIGNATURE',
          'This contract is not waiting for you'
        );
      return tx.contract.update({
        where: { id: contractId },
        data: { signatorySignedOn: today },
        include: { lifecycle: true },
      });
    }
  );
}
