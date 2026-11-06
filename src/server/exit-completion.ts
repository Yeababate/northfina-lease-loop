import { randomUUID } from 'node:crypto';
import { returnCanComplete } from '@/domain/early-exit';
import { isoDateSchema } from '@/data/schemas';
import { ApiError } from './api-response';
import { withAudit, type TransactionClient } from './audit';
import type { PrismaClient } from './prisma-client';
import { assertOwnedAssets, exitInclude, loadExitContract } from './exit-data';

async function finish(tx: TransactionClient, exitId: string, today: string, actor: string) {
  const request = await tx.exitRequest.findUniqueOrThrow({
    where: { id: exitId },
    include: exitInclude,
  });
  if (request.status === 'completed')
    throw new ApiError(409, 'EXIT_CHANGED', 'The exit was already completed');
  const { context, assetIds } = await loadExitContract(tx, request.contractId);
  if (context.status !== 'active')
    throw new ApiError(409, 'CONTRACT_COMPLETED', 'This lease is already complete');
  const endTerm = await tx.endTermChoice.findUnique({ where: { contractId: request.contractId } });
  if (endTerm?.kind === 'pass_on' && !endTerm.completedOn)
    throw new ApiError(409, 'EXIT_CHANGED', 'The lease is pending a pass-on');
  if (
    request.kind === 'return' &&
    !returnCanComplete(
      request.effectiveEndOn,
      assetIds,
      request.receipts.map((r) => r.assetId),
      request.balancesReviewed,
      today
    )
  ) {
    return request;
  }
  await assertOwnedAssets(tx, assetIds, request.providerId);
  for (const assetId of assetIds) {
    await tx.assetLifeCompletion.create({
      data: {
        id: randomUUID(),
        contractId: request.contractId,
        assetId,
        kind: request.kind,
        completedOn: today,
      },
    });
    await tx.asset.update({
      where: { id: assetId },
      data: {
        previous_lives: { increment: 1 },
        status: request.kind === 'return' ? 'returned' : 'reserved',
        ...(request.kind === 'buyout' ? { ownerId: request.renterId } : {}),
      },
    });
  }
  await tx.contractLifecycle.update({
    where: { contractId: request.contractId },
    data: {
      status: request.kind === 'return' ? 'completed_return' : 'completed_buyout',
      actualEndOn: request.kind === 'return' ? request.effectiveEndOn : today,
      revision: { increment: 1 },
    },
  });
  return tx.exitRequest.update({
    where: { id: exitId },
    data: {
      status: 'completed',
      openContractId: null,
      completedOn: today,
      completedBy: actor,
      revision: { increment: 1 },
    },
    include: exitInclude,
  });
}

export async function acknowledgeEarlyExit(
  db: PrismaClient,
  input: {
    exitId: string;
    userId: string;
    expectedRevision: number;
    balancesReviewed: boolean;
    assetIds?: string[];
  },
  today: string
) {
  isoDateSchema.parse(today);
  const existing = await db.exitRequest.findUnique({
    where: { id: input.exitId },
    include: exitInclude,
  });
  if (!existing) throw new ApiError(404, 'EXIT_NOT_FOUND', 'Exit request not found');
  if (existing.providerId !== input.userId)
    throw new ApiError(403, 'NOT_PROVIDER', 'Only the provider can acknowledge an exit');
  if (existing.status === 'completed') return existing;
  if (!input.balancesReviewed)
    throw new ApiError(
      422,
      'REVIEW_REQUIRED',
      'Review ordinary rent, balances and applicable tax before confirming'
    );
  const receiptIds = [...new Set(input.assetIds ?? [])];
  if (
    existing.kind === 'return' &&
    existing.balancesReviewed &&
    receiptIds.length &&
    receiptIds.every((id) => existing.receipts.some((r) => r.assetId === id))
  ) {
    return existing;
  }
  return withAudit(
    db,
    {
      actor: input.userId,
      action: existing.kind === 'return' ? 'exit.return_received' : 'exit.buyout_paid',
      entityType: 'exit',
      entityId: input.exitId,
      details: {
        assetIds: receiptIds,
        balancesReviewed: true,
        quote: JSON.parse(existing.quoteJson),
      },
    },
    async (tx) => {
      const request = await tx.exitRequest.findUniqueOrThrow({
        where: { id: input.exitId },
        include: exitInclude,
      });
      if (request.status !== 'pending' && request.status !== 'received')
        throw new ApiError(409, 'EXIT_CHANGED', 'The exit request changed');
      if (request.revision !== input.expectedRevision)
        throw new ApiError(409, 'EXIT_CHANGED', 'Refresh the exit request');
      const { assetIds, context } = await loadExitContract(tx, request.contractId);
      if (context.status !== 'active')
        throw new ApiError(409, 'CONTRACT_COMPLETED', 'This lease is already complete');
      await assertOwnedAssets(tx, assetIds, request.providerId);
      if (request.kind === 'return') {
        if (!receiptIds.length || receiptIds.some((id) => !assetIds.includes(id)))
          throw new ApiError(422, 'INVALID_RECEIPT', 'Choose items in this lease');
        for (const assetId of receiptIds) {
          await tx.exitReceipt.upsert({
            where: { exitId_assetId: { exitId: request.id, assetId } },
            create: {
              id: randomUUID(),
              exitId: request.id,
              assetId,
              receivedOn: today,
              receivedBy: input.userId,
            },
            update: {},
          });
        }
      }
      await tx.exitRequest.update({
        where: { id: request.id },
        data: {
          balancesReviewed: true,
          reviewedBy: input.userId,
          status: 'received',
          revision: { increment: 1 },
        },
      });
      return finish(tx, request.id, today, input.userId);
    }
  );
}

/** The server worker calls this without requiring either participant's browser. */
export async function finalizeDueReturns(db: PrismaClient, today: string) {
  isoDateSchema.parse(today);
  const due = await db.exitRequest.findMany({
    where: {
      kind: 'return',
      status: 'received',
      balancesReviewed: true,
      effectiveEndOn: { lte: today },
    },
    include: { receipts: true, contract: { include: { lines: true } } },
  });
  let completed = 0;
  const failedIds: string[] = [];
  for (const request of due) {
    const assetIds = request.contract.lines.length
      ? request.contract.lines.map((line) => line.assetId)
      : [request.contract.assetId];
    if (
      !returnCanComplete(
        request.effectiveEndOn,
        assetIds,
        request.receipts.map((r) => r.assetId),
        request.balancesReviewed,
        today
      )
    )
      continue;
    try {
      const result = await withAudit(
        db,
        {
          actor: 'system:lifecycle',
          action: 'exit.return_finalized',
          entityType: 'exit',
          entityId: request.id,
        },
        (tx) => finish(tx, request.id, today, 'system:lifecycle')
      );
      if (result.status === 'completed') completed++;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EXIT_CHANGED') continue;
      failedIds.push(request.id);
      console.error('Return finalization failed', request.id, error);
    }
  }
  return { completed, failedIds };
}
