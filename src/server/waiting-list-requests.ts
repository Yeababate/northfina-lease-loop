// Customers joining the second-life waiting list from an item they cannot lease right now.
// Their request goes into the same table the matching ranks (./waiting-list.ts), owned by
// the signed-in participant. Shown to others only as "A Lease Loop customer", never by name.
import { randomUUID } from 'node:crypto';
import type { AssetCategory } from '@/data/schemas';
import { expectedReceivingDate, replyLastDay } from '@/domain/waiting-list-follow-up';
import {
  checkWaitingListRequest,
  type WaitingListRequestInput,
} from '@/domain/waiting-list-request';
import type { Locale } from '@/i18n/locales';
import { ApiError } from './api-response';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';
import { todayIso } from './today';

/** How a customer's request appears to others (e.g. in a returned item's "Why not the others"). */
export const CUSTOMER_REQUEST_LABEL = 'A Lease Loop customer';

export async function joinWaitingList(
  db: PrismaClient,
  participantId: string,
  input: WaitingListRequestInput & { category: AssetCategory; locale?: Locale },
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
          locale: input.locale ?? 'en',
        },
      })
  );
}

type EntryRow = Awaited<ReturnType<PrismaClient['waitingListEntry']['findFirstOrThrow']>>;

export type MyWaitingListEntry = EntryRow & {
  /**
   * When the matched item can be received: its planned ready date (today or the end of the
   * lease it comes back from, whichever is later). Null while there is no match. A "match"
   * is the item the provider offered this entry (status offered or matched); a ranking that
   * the provider has not acted on yet can still change, so it is not promised to anyone.
   */
  expectedFrom: string | null;
  /** The last day to answer "Do you still want this?", or null when it was not asked. */
  replyBy: string | null;
};

/** The planned ready date of each entry's offered item, via the return it came in on. */
async function withExpectedDates(
  db: PrismaClient,
  rows: EntryRow[],
  today: string
): Promise<MyWaitingListEntry[]> {
  const matched = rows.filter(
    (row) => (row.status === 'offered' || row.status === 'matched') && row.offeredAssetId
  );
  const intakeIds = matched.flatMap((row) => (row.offeredIntakeId ? [row.offeredIntakeId] : []));
  const intakes = intakeIds.length
    ? await db.returnIntake.findMany({ where: { id: { in: intakeIds } } })
    : [];
  const contractIds = intakes.flatMap((intake) => (intake.contractId ? [intake.contractId] : []));
  const contracts = contractIds.length
    ? await db.contract.findMany({ where: { id: { in: contractIds } } })
    : [];
  const leaseEnd = new Map(
    intakes.map((intake) => [
      intake.id,
      contracts.find((contract) => contract.id === intake.contractId)?.endOn ?? null,
    ])
  );
  return rows.map((row) => ({
    ...row,
    expectedFrom: matched.includes(row)
      ? expectedReceivingDate(today, leaseEnd.get(row.offeredIntakeId ?? '') ?? null)
      : null,
    replyBy:
      row.status === 'waiting' && row.stillWantedAskedOn
        ? replyLastDay(row.stillWantedAskedOn)
        : null,
  }));
}

/** The signed-in customer's own requests, newest first, with their expected dates. */
export async function myWaitingList(
  db: PrismaClient,
  participantId: string,
  today: string = todayIso()
): Promise<MyWaitingListEntry[]> {
  const rows = await db.waitingListEntry.findMany({
    where: { participantId },
    orderBy: [{ signedUpOn: 'desc' }, { id: 'asc' }],
  });
  return withExpectedDates(db, rows, today);
}

/** One of the customer's own requests, or null (also for someone else's). */
export async function myWaitingListEntry(
  db: PrismaClient,
  participantId: string,
  entryId: string,
  today: string
): Promise<MyWaitingListEntry | null> {
  const row = await db.waitingListEntry.findFirst({ where: { id: entryId, participantId } });
  return row ? ((await withExpectedDates(db, [row], today))[0] ?? null) : null;
}
