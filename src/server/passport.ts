import { z } from 'zod';
import { loadRefurbishmentCosts } from '@/data/load';
import { assetConditionSchema, usageUnitSchema, type Asset } from '@/data/schemas';
import { buildPassport, passportWorkCost, type PassportEnding } from '@/domain/passport';
import { toAsset } from './assets';
import { loadImpactInputs, type ImpactInputs } from './impact';
import type { PrismaClient } from './prisma-client';

const readingSchema = z.object({
  condition: assetConditionSchema,
  usage: z.object({ unit: usageUnitSchema, value: z.number().int().nonnegative() }),
});
const signingAuditSchema = z.object({ assetId: z.string(), assetAtSigning: readingSchema });

/** Exposes asset history and prices without contract references, participant IDs or actor names. */
export async function loadPassport(
  db: PrismaClient,
  assetId: string,
  existing?: { asset: Asset; impact: ImpactInputs | null }
) {
  const row = existing ? null : await db.asset.findUnique({ where: { id: assetId } });
  const asset = existing?.asset ?? (row && toAsset(row));
  if (!asset) return null;
  const [contracts, intakes, costs, impact] = await Promise.all([
    db.contract.findMany({
      where: { OR: [{ assetId }, { lines: { some: { assetId } } }] },
      include: {
        lifecycle: true,
        lines: { where: { assetId } },
        lifeCompletions: { where: { assetId } },
      },
      orderBy: [{ startOn: 'asc' }, { signedOn: 'asc' }, { id: 'asc' }],
    }),
    db.returnIntake.findMany({
      where: { assetId },
      include: {
        inspections: { orderBy: { id: 'desc' }, take: 1 },
        work: { orderBy: { id: 'asc' } },
      },
      orderBy: [{ receivedOn: 'asc' }, { id: 'asc' }],
    }),
    loadRefurbishmentCosts(),
    existing ? existing.impact : loadImpactInputs(),
  ]);
  const audits = await db.auditLog.findMany({
    where: {
      entity_type: 'contract',
      action: 'contract.signed',
      entity_id: { in: contracts.map((contract) => contract.id) },
    },
    select: { entity_id: true, details_json: true },
    orderBy: { id: 'asc' },
  });
  const signed = new Map(
    audits.flatMap((audit) => {
      if (!audit.details_json) return [];
      const parsed = signingAuditSchema.safeParse(JSON.parse(audit.details_json));
      return parsed.success && parsed.data.assetId === assetId
        ? [[audit.entity_id, parsed.data.assetAtSigning] as const]
        : [];
    })
  );
  const intakeByContract = new Map(intakes.map((intake) => [intake.contractId, intake]));
  const workFor = (intake: (typeof intakes)[number]) =>
    intake.work.map((step) => ({
      actionId: step.actionId,
      on: step.performedOn,
      costCents: passportWorkCost(
        step.actionId,
        costs[asset.category],
        intake.inspections[0]?.hoursSinceService ?? null
      ),
    }));

  const lives = contracts.map((contract) => {
    const intake = intakeByContract.get(contract.id);
    const inspection = intake?.inspections[0];
    const completion = contract.lifeCompletions[0];
    const actualEnd =
      contract.lifecycle?.actualEndOn ?? intake?.completedOn ?? completion?.completedOn ?? null;
    const status = contract.lifecycle?.status;
    const ending: PassportEnding =
      status === 'passed_on' || completion?.kind === 'pass_on'
        ? 'passed_on'
        : status === 'completed_buyout' || ['buyout', 'end_buyout'].includes(completion?.kind ?? '')
          ? 'bought_out'
          : actualEnd
            ? actualEnd < contract.endOn
              ? 'exited_early'
              : 'returned'
            : 'active';
    const priorUsage = intakes
      .filter(
        (old) =>
          old.contractId !== contract.id &&
          old.relistedOn !== null &&
          old.relistedOn <= contract.signedOn
      )
      .flatMap((old) => old.work)
      .reduce((sum, step) => sum + (step.usageAfter < step.usageBefore ? step.usageBefore : 0), 0);
    const price = contract.lines[0] ?? contract;
    return {
      startOn: contract.startOn,
      endOn: actualEnd,
      scheduledEndOn: contract.endOn,
      ending,
      termMonths: contract.termMonths,
      monthlyNetCents: price.monthlyNetCents,
      priceSource:
        price.priceSource === 'next_life' ? ('next_life' as const) : ('price_list' as const),
      priceListVersion: price.priceListVersion,
      start: signed.get(contract.id) ?? null,
      returned: inspection
        ? readingSchema.parse({
            condition: inspection.condition,
            usage: { unit: asset.usage.unit, value: inspection.usageValue },
          })
        : null,
      priorUsage,
      countedCompletion: Boolean(completion || intake?.completedOn),
      refurbishment: intake ? workFor(intake) : [],
    };
  });

  return buildPassport({
    category: asset.category,
    previousLives: asset.previous_lives,
    lives,
    impact,
    importedWork: intakes.filter((intake) => intake.contractId === null).flatMap(workFor),
  });
}
