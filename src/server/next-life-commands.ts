// Audited commands for a returned item's next life: receipt, lease completion, inspection,
// work records and relisting. Each one re-checks scope and the domain rules inside its
// withAudit transaction and writes every affected row through that `tx`, so a stale or
// concurrent request either applies completely or not at all. Relisting changes availability;
// with a next-life plan (src/server/second-life.ts) it also stores the item's next-life price,
// which the catalogue then uses (src/server/price-lists.ts). Without one, the price is kept.
import { randomUUID } from 'node:crypto';
import { loadRefurbishmentCosts } from '@/data/load';
import { assetStatusSchema, type AssetCondition } from '@/data/schemas';
import {
  checkInspection,
  checkReceipt,
  checkWork,
  deriveNextLife,
  isLeaseDueToComplete,
} from '@/domain/next-life';
import { ApiError } from './api-response';
import { withAudit, type TransactionClient } from './audit';
import { loadIntake, sequencedId } from './next-life-reads';
import type { PrismaClient } from './prisma-client';

type Event = {
  assetId: string;
  intakeId: string;
  contractId: string | null;
  type: string;
  on: string;
  actor: string;
  details?: unknown;
};

function addEvent(tx: TransactionClient, event: Event) {
  const { details, ...row } = event;
  return tx.assetLifecycleEvent.create({
    data: { ...row, detailsJson: details === undefined ? null : JSON.stringify(details) },
  });
}

/**
 * Finalizes a received lease: completedOn is set once (guarded), and previous_lives goes up
 * by exactly one in the same transaction. Repeated or concurrent calls change nothing.
 */
async function completeLease(
  tx: TransactionClient,
  intake: { id: string; assetId: string; contractId: string | null },
  today: string,
  actor: string
): Promise<boolean> {
  const marked = await tx.returnIntake.updateMany({
    where: { id: intake.id, completedOn: null },
    data: { completedOn: today },
  });
  if (marked.count !== 1) return false;
  await tx.asset.update({
    where: { id: intake.assetId },
    data: { previous_lives: { increment: 1 } },
  });
  await addEvent(tx, {
    assetId: intake.assetId,
    intakeId: intake.id,
    contractId: intake.contractId,
    type: 'life_completed',
    on: today,
    actor,
  });
  return true;
}

/** The contract's provider records physical receipt of the item (D10). */
export async function recordReceipt(
  db: PrismaClient,
  providerId: string,
  contractId: string,
  today: string
) {
  const link = await db.contractProvider.findUnique({ where: { contractId } });
  if (!link || link.providerId !== providerId)
    throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'Contract not found');
  const id = randomUUID();
  const details: Record<string, unknown> = { contractId };
  return withAudit(
    db,
    {
      actor: providerId,
      action: 'return.received',
      entityType: 'return_intake',
      entityId: id,
      details,
    },
    async (tx) => {
      const [contract, asset, existing] = await Promise.all([
        tx.contract.findUniqueOrThrow({ where: { id: contractId } }),
        tx.asset.findUniqueOrThrow({ where: { id: link.assetId } }),
        tx.returnIntake.findFirst({ where: { contractId, assetId: link.assetId } }),
      ]);
      const check = checkReceipt(
        {
          startOn: contract.startOn,
          endOn: contract.endOn,
          alreadyReceived: existing !== null,
          assetStatus: assetStatusSchema.parse(asset.status),
        },
        today
      );
      if (!check.ok) throw new ApiError(409, check.reason.toUpperCase(), 'Receipt not possible');
      const moved = await tx.asset.updateMany({
        where: { id: asset.id, status: 'reserved' },
        data: { status: 'returned' },
      });
      if (moved.count !== 1) throw new ApiError(409, 'ASSET_NOT_LEASED', 'Receipt not possible');
      const intake = await tx.returnIntake.create({
        data: {
          id,
          assetId: asset.id,
          contractId,
          providerId,
          source: 'receipt',
          receivedOn: today,
          receivedBy: providerId,
        },
      });
      await addEvent(tx, {
        assetId: asset.id,
        intakeId: id,
        contractId,
        type: 'received',
        on: today,
        actor: providerId,
        details: { early: !check.completesLease },
      });
      details.completed =
        check.completesLease && (await completeLease(tx, intake, today, providerId));
      return { id, assetId: asset.id, receivedOn: today, completed: details.completed };
    }
  );
}

/**
 * Finalizes every received lease whose exclusive end has arrived. Idempotent; called by the
 * returns API before reading and by relisting. A startup/background runner can call it too.
 */
export async function finalizeDueReturns(db: PrismaClient, today: string) {
  const open = await db.returnIntake.findMany({
    where: { completedOn: null, receivedOn: { not: null }, contractId: { not: null } },
  });
  let completed = 0;
  for (const intake of open) {
    const contract = await db.contract.findUnique({ where: { id: intake.contractId! } });
    if (!contract || !isLeaseDueToComplete({ ...intake, endOn: contract.endOn }, today)) continue;
    const done = await withAudit(
      db,
      {
        actor: 'system',
        action: 'return.lease_completed',
        entityType: 'return_intake',
        entityId: intake.id,
        details: { contractId: intake.contractId, on: today },
      },
      (tx) => completeLease(tx, intake, today, 'system')
    );
    if (done) completed += 1;
  }
  return completed;
}

/**
 * Shared frame for intake commands: claims the expected revision first (a stale request fails
 * with REVISION_CHANGED and writes nothing), then loads the facts through the same tx.
 */
async function intakeCommand<T>(
  db: PrismaClient,
  input: { providerId: string; intakeId: string; expectedRevision: number; action: string },
  work: (
    tx: TransactionClient,
    bundle: Awaited<ReturnType<typeof loadIntake>>,
    details: Record<string, unknown>
  ) => Promise<T>
) {
  const details: Record<string, unknown> = { expectedRevision: input.expectedRevision };
  return withAudit(
    db,
    {
      actor: input.providerId,
      action: input.action,
      entityType: 'return_intake',
      entityId: input.intakeId,
      // Filled in by `work`; withAudit serializes it after the work has run.
      details,
    },
    async (tx) => {
      const bundle = await loadIntake(tx, input.providerId, input.intakeId);
      const claimed = await tx.returnIntake.updateMany({
        where: { id: input.intakeId, revision: input.expectedRevision },
        data: { revision: { increment: 1 } },
      });
      if (claimed.count !== 1)
        throw new ApiError(409, 'REVISION_CHANGED', 'This item changed. Refresh and try again');
      return work(tx, bundle, details);
    }
  );
}

export type InspectionCommand = {
  expectedRevision: number;
  condition: AssetCondition;
  usageValue: number;
  hoursSinceService: number | null;
};

/** Records condition and counter as returned; the asset row shows the inspected state. */
export async function recordInspection(
  db: PrismaClient,
  providerId: string,
  intakeId: string,
  input: InspectionCommand,
  today: string
) {
  const { expectedRevision, ...reading } = input;
  return intakeCommand(
    db,
    { providerId, intakeId, expectedRevision, action: 'return.inspected' },
    async (tx, { asset, facts, intake }, details) => {
      const check = checkInspection(reading, { ...facts, recordedUsage: asset.usage_value });
      if (!check.ok) throw new ApiError(422, check.reason.toUpperCase(), 'Inspection not accepted');
      const row = {
        id: sequencedId('insp', intakeId, intake.revision),
        intakeId,
        inspectedOn: today,
        actor: providerId,
        conditionBefore: asset.condition,
        condition: reading.condition,
        usageBefore: asset.usage_value,
        usageValue: reading.usageValue,
        hoursSinceService: reading.hoursSinceService,
      };
      await tx.returnInspection.create({ data: row });
      await tx.asset.update({
        where: { id: asset.id },
        data: { condition: reading.condition, usage_value: reading.usageValue },
      });
      Object.assign(details, { inspectionId: row.id, ...reading });
      await addEvent(tx, {
        assetId: asset.id,
        intakeId,
        contractId: intake.contractId,
        type: 'inspected',
        on: today,
        actor: providerId,
        details: { condition: reading.condition, usageValue: reading.usageValue },
      });
      return { id: row.id, revision: intake.revision + 1 };
    }
  );
}

/** Records one step the provider reports was performed, with before/after readings. */
export async function recordWork(
  db: PrismaClient,
  providerId: string,
  intakeId: string,
  input: { expectedRevision: number; actionId: string },
  today: string
) {
  const rules = await loadRefurbishmentCosts();
  return intakeCommand(
    db,
    {
      providerId,
      intakeId,
      expectedRevision: input.expectedRevision,
      action: 'return.work_recorded',
    },
    async (tx, { asset, facts, intake }, details) => {
      const check = checkWork(input.actionId, facts, rules);
      if (!check.ok) throw new ApiError(422, check.reason.toUpperCase(), 'Work not accepted');
      const row = {
        id: sequencedId('work', intakeId, intake.revision),
        intakeId,
        actionId: input.actionId,
        performedOn: today,
        actor: providerId,
        conditionBefore: check.before.condition,
        conditionAfter: check.after.condition,
        usageBefore: check.before.usageValue,
        usageAfter: check.after.usageValue,
      };
      await tx.refurbishmentWork.create({ data: row });
      await tx.asset.update({
        where: { id: asset.id },
        data: { condition: check.after.condition, usage_value: check.after.usageValue },
      });
      const change = { actionId: input.actionId, before: check.before, after: check.after };
      Object.assign(details, { workId: row.id, ...change });
      await addEvent(tx, {
        assetId: asset.id,
        intakeId,
        contractId: intake.contractId,
        type: 'work_recorded',
        on: today,
        actor: providerId,
        details: change,
      });
      return { id: row.id, revision: intake.revision + 1 };
    }
  );
}

/**
 * Makes the item available for its next lease. Ownership, revision, completion, required work,
 * condition and returned status are all re-validated in the transaction; a competing
 * reservation flips the guarded status update and rolls everything back.
 */
export async function relist(
  db: PrismaClient,
  providerId: string,
  intakeId: string,
  input: {
    expectedRevision: number;
    /** From the next-life plan: the new list price, the plan itself, and its listing minimum. */
    nextLife?: { priceCents: number; planJson: string; listingMinimum: AssetCondition };
  },
  today: string
) {
  await finalizeDueReturns(db, today);
  const rules = await loadRefurbishmentCosts();
  return intakeCommand(
    db,
    { providerId, intakeId, expectedRevision: input.expectedRevision, action: 'return.relisted' },
    async (tx, { asset, facts, intake }, details) => {
      const view = deriveNextLife(facts, rules, input.nextLife?.listingMinimum);
      if (!view.canRelist)
        throw new ApiError(409, 'NOT_READY', 'This item cannot be relisted yet', view.blockers);
      const released = await tx.asset.updateMany({
        where: { id: asset.id, status: 'returned' },
        data: { status: 'available' },
      });
      if (released.count !== 1)
        throw new ApiError(409, 'ASSET_NOT_RETURNED', 'This item cannot be relisted yet');
      await tx.returnIntake.update({
        where: { id: intakeId },
        data: {
          relistedOn: today,
          relistedBy: providerId,
          nextLifePriceCents: input.nextLife?.priceCents ?? null,
          nextLifePlanJson: input.nextLife?.planJson ?? null,
        },
      });
      Object.assign(details, {
        condition: view.current?.condition,
        relistedOn: today,
        nextLifePriceCents: input.nextLife?.priceCents ?? null,
      });
      await addEvent(tx, {
        assetId: asset.id,
        intakeId,
        contractId: intake.contractId,
        type: 'relisted',
        on: today,
        actor: providerId,
        details: {
          condition: view.current?.condition,
          usageValue: view.current?.usageValue,
          priceCents: input.nextLife?.priceCents ?? null,
        },
      });
      return { id: intakeId, assetId: asset.id, relistedOn: today, revision: intake.revision + 1 };
    }
  );
}
