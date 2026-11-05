// Provider-scoped reads of returned stock. A provider sees an intake only while they both
// received it and currently own the item; any other id answers 404, the same as a missing
// one, so foreign ids reveal nothing. Former renters' identities and contract financial
// terms are never part of these views.
import { loadRefurbishmentCosts } from '@/data/load';
import {
  assetCategorySchema,
  assetConditionSchema,
  assetStatusSchema,
  usageUnitSchema,
} from '@/data/schemas';
import { deriveNextLife, type NextLifeFacts } from '@/domain/next-life';
import { ApiError } from './api-response';
import type { TransactionClient } from './audit';
import type { PrismaClient } from './prisma-client';

type Reader = PrismaClient | TransactionClient;

/** Record ids embed the intake revision, zero-padded, so they sort in recorded order. */
export function sequencedId(prefix: string, intakeId: string, revision: number): string {
  return `${prefix}-${intakeId}-${String(revision).padStart(6, '0')}`;
}

/** Everything a decision needs, loaded through one client (a transaction for commands). */
export async function loadIntake(db: Reader, providerId: string, intakeId: string) {
  const intake = await db.returnIntake.findUnique({
    where: { id: intakeId },
    include: { inspections: true, work: true },
  });
  if (!intake || intake.providerId !== providerId) throw notFound();
  const [asset, ownership, contract] = await Promise.all([
    db.asset.findUnique({ where: { id: intake.assetId } }),
    db.assetOwnership.findUnique({ where: { assetId: intake.assetId } }),
    intake.contractId ? db.contract.findUnique({ where: { id: intake.contractId } }) : null,
  ]);
  // Current ownership is required to manage the item, separately from who received it.
  if (!asset || ownership?.providerId !== providerId) throw notFound();
  const byId = <T extends { id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const inspections = byId(intake.inspections);
  const work = byId(intake.work);
  const latest = inspections.at(-1);
  const facts: NextLifeFacts = {
    category: assetCategorySchema.parse(asset.category),
    usageUnit: usageUnitSchema.parse(asset.usage_unit),
    lease: contract ? { endOn: contract.endOn } : null,
    receivedOn: intake.receivedOn,
    completedOn: intake.completedOn,
    inspection: latest
      ? {
          condition: assetConditionSchema.parse(latest.condition),
          usageValue: latest.usageValue,
          hoursSinceService: latest.hoursSinceService,
        }
      : null,
    work: work.map((w) => ({
      actionId: w.actionId,
      conditionAfter: assetConditionSchema.parse(w.conditionAfter),
      usageAfter: w.usageAfter,
    })),
    assetStatus: assetStatusSchema.parse(asset.status),
    relistedOn: intake.relistedOn,
  };
  return { intake, asset, contract, inspections, work, facts };
}

export type IntakeBundle = Awaited<ReturnType<typeof loadIntake>>;

function notFound() {
  return new ApiError(404, 'RETURN_NOT_FOUND', 'Returned item not found');
}

function summary(bundle: IntakeBundle, view: ReturnType<typeof deriveNextLife>) {
  const { intake, asset, contract } = bundle;
  return {
    id: intake.id,
    revision: intake.revision,
    source: intake.source,
    asset: {
      id: asset.id,
      category: asset.category,
      make: asset.make,
      model: asset.model,
      condition: asset.condition,
      usage: { unit: asset.usage_unit, value: asset.usage_value },
      previousLives: asset.previous_lives,
      status: asset.status,
    },
    lease: contract
      ? { contractId: contract.id, startOn: contract.startOn, endOn: contract.endOn }
      : null,
    receivedOn: intake.receivedOn,
    completedOn: intake.completedOn,
    relistedOn: intake.relistedOn,
    ...view,
  };
}

/** The provider's returned stock that has not been relisted yet, oldest receipt first. */
export async function listReturns(db: PrismaClient, providerId: string) {
  const rules = await loadRefurbishmentCosts();
  const intakes = await db.returnIntake.findMany({
    where: { providerId, relistedOn: null },
    select: { id: true },
    orderBy: [{ receivedOn: 'asc' }, { id: 'asc' }],
  });
  const rows = [];
  for (const { id } of intakes) {
    try {
      const bundle = await loadIntake(db, providerId, id);
      rows.push(summary(bundle, deriveNextLife(bundle.facts, rules)));
    } catch (error) {
      // Items sold to someone else since receipt are no longer this provider's stock.
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
  }
  return rows;
}

/** One intake with its inspection/work history and nonpersonal lifecycle events. */
export async function getReturn(db: PrismaClient, providerId: string, intakeId: string) {
  const [bundle, rules] = await Promise.all([
    loadIntake(db, providerId, intakeId),
    loadRefurbishmentCosts(),
  ]);
  const events = await db.assetLifecycleEvent.findMany({
    where: { assetId: bundle.asset.id },
    orderBy: { id: 'asc' },
  });
  return {
    ...summary(bundle, deriveNextLife(bundle.facts, rules)),
    inspections: bundle.inspections.map(({ intakeId: _i, createdAt: _c, ...row }) => row),
    work: bundle.work.map(({ intakeId: _i, createdAt: _c, ...row }) => row),
    history: events.map((e) => ({
      type: e.type,
      on: e.on,
      intakeId: e.intakeId,
      details: e.detailsJson === null ? null : JSON.parse(e.detailsJson),
    })),
  };
}
