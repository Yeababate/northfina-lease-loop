import { withAudit } from './audit';
import { ApiError } from './api-response';
import type { PrismaClient } from './prisma-client';

/** Explicit operator mapping, never an inference from applicant/display names. */
export async function mapLegacyParticipants(
  db: PrismaClient,
  input: {
    contractId: string;
    renterId: string;
    providerId: string;
    actor: string;
  }
) {
  if (input.renterId === input.providerId)
    throw new ApiError(422, 'INVALID_PARTICIPANTS', 'Distinct participants required');
  const users = await db.demoUser.count({
    where: { id: { in: [input.renterId, input.providerId] } },
  });
  if (users !== 2) throw new ApiError(422, 'INVALID_PARTICIPANTS', 'Known participants required');
  return withAudit(
    db,
    {
      actor: input.actor,
      action: 'contract.participants_mapped',
      entityType: 'contract',
      entityId: input.contractId,
      details: { renterId: input.renterId, providerId: input.providerId },
    },
    async (tx) => {
      const result = await tx.contract.updateMany({
        where: { id: input.contractId, renterId: null, providerId: null },
        data: { renterId: input.renterId, providerId: input.providerId },
      });
      if (result.count !== 1)
        throw new ApiError(409, 'CONTRACT_ALREADY_MAPPED', 'Contract missing or already mapped');
      return tx.contract.findUniqueOrThrow({ where: { id: input.contractId } });
    }
  );
}

/** Import exact locked scalar values into lines; no catalogue lookup or re-pricing. */
export async function backfillLegacyLines(db: PrismaClient, actor: string) {
  const contracts = await db.contract.findMany({ where: { lines: { none: {} } } });
  let imported = 0;
  for (const contract of contracts) {
    await withAudit(
      db,
      {
        actor,
        action: 'contract.legacy_line_imported',
        entityType: 'contract',
        entityId: contract.id,
      },
      async (tx) => {
        if (await tx.contractLine.count({ where: { contractId: contract.id } })) return;
        await tx.contractLine.create({
          data: {
            id: `${contract.id}:${contract.assetId}`,
            contractId: contract.id,
            assetId: contract.assetId,
            listPriceCents: contract.listPriceCents,
            downPaymentCents: contract.downPaymentCents,
            financedCents: contract.financedCents,
            monthlyNetCents: contract.monthlyNetCents,
            buyoutNetCents: contract.buyoutNetCents,
            priceListVersion: contract.priceListVersion,
            coefficientVersion: contract.coefficientVersion,
            coefficientId: contract.coefficientId,
            band: contract.band,
            factor: contract.factor,
          },
        });
        imported += 1;
      }
    );
  }
  return imported;
}
