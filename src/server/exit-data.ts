import type { PrismaClient } from './prisma-client';
import type { TransactionClient } from './audit';
import { ApiError } from './api-response';
import type { ExitContract, ExitQuote } from '@/domain/early-exit';

export async function loadExitContract(db: PrismaClient | TransactionClient, id: string) {
  const contract = await db.contract.findUnique({
    where: { id },
    include: { lines: true, lifecycle: true },
  });
  if (!contract) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'Contract not found');
  const context: ExitContract = {
    ...contract,
    status: contract.lifecycle?.status ?? 'active',
    revision: contract.lifecycle?.revision ?? 0,
  };
  const assetIds = contract.lines.length
    ? contract.lines.map((line) => line.assetId)
    : [contract.assetId];
  return { contract, context, assetIds };
}

export function assertParticipant(context: ExitContract, userId: string) {
  if (userId !== context.renterId && userId !== context.providerId) {
    throw new ApiError(403, 'NOT_PARTICIPANT', 'This contract is not yours');
  }
}

export async function assertOwnedAssets(
  db: TransactionClient,
  assetIds: readonly string[],
  providerId: string
) {
  const count = await db.asset.count({
    where: { id: { in: [...assetIds] }, ownerId: providerId, status: 'reserved' },
  });
  if (count !== assetIds.length)
    throw new ApiError(409, 'ASSET_CHANGED', 'The item needs provider review');
}

/** Only server-written quote snapshots are read here, not arbitrary request JSON. */
export function storedQuote(json: string): ExitQuote {
  return JSON.parse(json) as ExitQuote;
}

export const exitInclude = { receipts: true } as const;
