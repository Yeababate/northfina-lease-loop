// Customers joining the second-life waiting list from an item they cannot lease right now.
// Their request goes into the same table the matching ranks (./waiting-list.ts), owned by
// the signed-in participant. Shown to others only as "A Lease Loop customer", never by name.
import { randomUUID } from 'node:crypto';
import type { AssetCategory } from '@/data/schemas';
import {
  checkWaitingListRequest,
  type WaitingListRequestInput,
} from '@/domain/waiting-list-request';
import { ApiError } from './api-response';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';

/** How a customer's request appears to others (e.g. in a returned item's "Why not the others"). */
export const CUSTOMER_REQUEST_LABEL = 'A Lease Loop customer';

export async function joinWaitingList(
  db: PrismaClient,
  participantId: string,
  input: WaitingListRequestInput & { category: AssetCategory },
  context: { today: string; terms: readonly number[] }
) {
  const check = checkWaitingListRequest(input, context);
  if (!check.ok)
    throw new ApiError(422, 'INVALID_WAITING_REQUEST', 'Check the request', check.problems);
  const id = `wait-${randomUUID().slice(0, 8)}`;
  return withAudit(
    db,
    {
      actor: participantId,
      action: 'waiting_list.joined',
      entityType: 'waiting_list',
      entityId: id,
      details: { category: input.category, neededBy: input.neededBy },
    },
    (tx) =>
      tx.waitingListEntry.create({
        data: {
          id,
          participantId,
          category: input.category,
          maxMonthlyNetRentCents: input.maxMonthlyNetRentCents,
          minCondition: input.minCondition,
          preferredTermMonths: input.preferredTermMonths,
          neededBy: input.neededBy,
          signedUpOn: context.today,
          who: CUSTOMER_REQUEST_LABEL,
        },
      })
  );
}

/** The signed-in customer's own requests, newest first. */
export function myWaitingList(db: PrismaClient, participantId: string) {
  return db.waitingListEntry.findMany({
    where: { participantId },
    orderBy: [{ signedUpOn: 'desc' }, { id: 'asc' }],
  });
}
