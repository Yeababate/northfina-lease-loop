import {
  previewEarlyExit,
  sameExitQuote,
  type ExitKind,
  type ExitQuote,
} from '@/domain/early-exit';
import { ApiError } from './api-response';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';
import {
  assertOwnedAssets,
  assertParticipant,
  exitInclude,
  loadExitContract,
  storedQuote,
} from './exit-data';

export async function readExitView(
  db: PrismaClient,
  contractId: string,
  userId: string,
  today: string
) {
  const { context, assetIds } = await loadExitContract(db, contractId);
  assertParticipant(context, userId);
  const requests = await db.exitRequest.findMany({
    where: { contractId },
    orderBy: { requestedOn: 'desc' },
    include: exitInclude,
  });
  // Several requests may be withdrawn on the same calendar day. The accepted contract
  // revision, unlike a random UUID or date alone, preserves their actual sequence.
  const request =
    requests.toSorted(
      (a, b) =>
        storedQuote(b.quoteJson).contractRevision - storedQuote(a.quoteJson).contractRevision
    )[0] ?? null;
  const pending = await db.exitRequest.findUnique({
    where: { openContractId: contractId },
    include: exitInclude,
  });
  const latest = pending ?? request;
  return {
    role: context.renterId === userId ? ('renter' as const) : ('provider' as const),
    assetIds,
    status: context.status,
    request: latest ? { ...latest, quote: storedQuote(latest.quoteJson) } : null,
    ordinaryRentAndTax: 'provider_review_required' as const,
    returnQuote: previewEarlyExit(context, 'return', userId, today),
    buyoutQuote: previewEarlyExit(context, 'buyout', userId, today),
  };
}

export async function requestEarlyExit(
  db: PrismaClient,
  input: {
    requestId: string;
    contractId: string;
    userId: string;
    kind: ExitKind;
    expectedQuote: ExitQuote;
  },
  today: string
) {
  const existing = await db.exitRequest.findUnique({
    where: { id: input.requestId },
    include: exitInclude,
  });
  if (existing) {
    if (
      existing.contractId !== input.contractId ||
      existing.renterId !== input.userId ||
      existing.kind !== input.kind ||
      !sameExitQuote(JSON.parse(existing.quoteJson), input.expectedQuote)
    ) {
      throw new ApiError(409, 'REQUEST_ID_CONFLICT', 'Use a new request identifier');
    }
    return existing;
  }
  try {
    return await withAudit(
      db,
      {
        actor: input.userId,
        action: 'exit.requested',
        entityType: 'contract',
        entityId: input.contractId,
        details: { requestId: input.requestId, kind: input.kind, quote: input.expectedQuote },
      },
      async (tx) => {
        const { context, assetIds } = await loadExitContract(tx, input.contractId);
        const result = previewEarlyExit(context, input.kind, input.userId, today);
        if (!result.ok)
          throw new ApiError(
            422,
            'EXIT_NOT_ALLOWED',
            'This lease cannot be ended early',
            result.reason
          );
        if (!sameExitQuote(result.quote, input.expectedQuote))
          throw new ApiError(409, 'QUOTE_CHANGED', 'Review the updated exit quote');
        const [exit, endTerm] = await Promise.all([
          tx.exitRequest.findUnique({ where: { openContractId: input.contractId } }),
          tx.endTermChoice.findUnique({ where: { contractId: input.contractId } }),
        ]);
        if (exit || endTerm) {
          throw new ApiError(409, 'EXIT_PENDING', 'An exit is already pending');
        }
        await assertOwnedAssets(tx, assetIds, context.providerId!);
        await tx.contractLifecycle.upsert({
          where: { contractId: input.contractId },
          create: {
            contractId: input.contractId,
            revision: 1,
          },
          update: { revision: { increment: 1 } },
        });
        return tx.exitRequest.create({
          data: {
            id: input.requestId,
            contractId: input.contractId,
            openContractId: input.contractId,
            renterId: context.renterId!,
            providerId: context.providerId!,
            kind: input.kind,
            requestedOn: today,
            effectiveEndOn: result.quote.effectiveEndOn,
            quoteJson: JSON.stringify(result.quote),
          },
          include: exitInclude,
        });
      }
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      throw new ApiError(409, 'EXIT_PENDING', 'An exit is already pending');
    }
    throw error;
  }
}

export async function withdrawEarlyExit(
  db: PrismaClient,
  exitId: string,
  userId: string,
  expectedRevision: number
) {
  const existing = await db.exitRequest.findUnique({ where: { id: exitId }, include: exitInclude });
  if (!existing) throw new ApiError(404, 'EXIT_NOT_FOUND', 'Exit request not found');
  if (existing.renterId !== userId)
    throw new ApiError(403, 'NOT_RENTER', 'Only the renter can withdraw');
  if (existing.status === 'withdrawn') return existing;
  return withAudit(
    db,
    { actor: userId, action: 'exit.withdrawn', entityType: 'exit', entityId: exitId },
    async (tx) => {
      const request = await tx.exitRequest.findUniqueOrThrow({
        where: { id: exitId },
        include: exitInclude,
      });
      if (
        request.status !== 'pending' ||
        request.receipts.length ||
        request.revision !== expectedRevision
      ) {
        throw new ApiError(409, 'EXIT_CHANGED', 'This exit can no longer be withdrawn');
      }
      await tx.contractLifecycle.update({
        where: { contractId: request.contractId },
        data: { revision: { increment: 1 } },
      });
      return tx.exitRequest.update({
        where: { id: exitId },
        data: { status: 'withdrawn', openContractId: null, revision: { increment: 1 } },
        include: exitInclude,
      });
    }
  );
}
