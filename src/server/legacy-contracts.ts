import { withAudit } from './audit';
import { ApiError } from './api-response';
import type { PrismaClient } from './prisma-client';

class ParticipantRecoveryRace extends Error {}

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

/**
 * Recover participant IDs after an older SQLite table rebuild dropped the nullable fields.
 * The renter comes only from the audited signing actor, and the provider only from the
 * immutable ContractProvider row. Human names are never converted to IDs here.
 */
export async function restoreParticipantsFromSigningRecords(db: PrismaClient) {
  const candidates = await db.contract.findMany({
    where: { renterId: null, providerId: null },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  let restored = 0;
  for (const { id } of candidates) {
    const [signings, providerLink] = await Promise.all([
      db.auditLog.findMany({
        where: { action: 'contract.signed', entity_type: 'contract', entity_id: id },
        orderBy: { id: 'asc' },
        select: { actor: true },
      }),
      db.contractProvider.findUnique({ where: { contractId: id }, select: { providerId: true } }),
    ]);
    if (!signings.length || !providerLink) continue;
    const knownUsers = await db.demoUser.findMany({
      where: { id: { in: signings.map((signing) => signing.actor) } },
      select: { id: true },
    });
    const knownIds = new Set(knownUsers.map((user) => user.id));
    const renterId = [...signings]
      .reverse()
      .find(({ actor }) => knownIds.has(actor) && actor !== providerLink.providerId)?.actor;
    if (!renterId) continue;
    const [provider, providerRecord] = await Promise.all([
      db.demoUser.findUnique({ where: { id: providerLink.providerId }, select: { id: true } }),
      db.provider.findUnique({ where: { id: providerLink.providerId }, select: { id: true } }),
    ]);
    if (!provider || !providerRecord) continue;

    try {
      await withAudit(
        db,
        {
          actor: 'system:contract-participants',
          action: 'contract.participants_recovered',
          entityType: 'contract',
          entityId: id,
          details: { renterId, providerId: provider.id, source: 'signing_records' },
        },
        async (tx) => {
          const result = await tx.contract.updateMany({
            where: { id, renterId: null, providerId: null },
            data: { renterId, providerId: provider.id },
          });
          if (result.count !== 1) throw new ParticipantRecoveryRace();
        }
      );
      restored += 1;
    } catch (error) {
      if (!(error instanceof ParticipantRecoveryRace)) throw error;
    }
  }
  return restored;
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
            priceSource: contract.priceSource,
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
