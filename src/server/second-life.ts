// Second life, run by Lease Loop itself (#38–#40): every returned item that is not relisted yet
// gets a next-life plan (src/domain/second-life.ts), and items whose plan can go ahead are
// inspected, worked on as planned and relisted at their next-life price, through the same
// audited commands a provider would use (./next-life-commands.ts). Runs at server start and
// after seeding; safe to run again. Items the rules cannot decide (unknown service hours, worth
// less than the smallest lease) are left as they are, with their reason shown on the item page.
import {
  loadCoefficientTable,
  loadPriceLists,
  loadRefurbishmentCosts,
  loadResidualCurves,
  loadSecondLifeDemand,
} from '@/data/load';
import { assetCategorySchema, assetConditionSchema, usageUnitSchema } from '@/data/schemas';
import { planNextLives, type NextLifePlan, type ReturnedItem } from '@/domain/second-life';
import { finalizeDueReturns, recordInspection, recordWork, relist } from './next-life-commands';
import { loadIntake } from './next-life-reads';
import { firstListPrice } from './price-lists';
import type { PrismaClient } from './prisma-client';

async function planData() {
  const [lists, table, rules, curves, waitingList] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadRefurbishmentCosts(),
    loadResidualCurves(),
    loadSecondLifeDemand(),
  ]);
  return { lists, table, rules, curves, waitingList };
}

/** Returned items not relisted yet, oldest intake first, in the shape the planner reads. */
async function openReturns(db: PrismaClient, lists: Awaited<ReturnType<typeof loadPriceLists>>) {
  const intakes = await db.returnIntake.findMany({
    where: { relistedOn: null },
    orderBy: [{ receivedOn: 'asc' }, { id: 'asc' }],
  });
  const open: { intakeId: string; providerId: string; item: ReturnedItem }[] = [];
  for (const intake of intakes) {
    const bundle = await loadIntake(db, intake.providerId, intake.id).catch(() => null);
    if (!bundle || bundle.facts.assetStatus !== 'returned') continue;
    if (bundle.facts.lease && bundle.facts.completedOn === null) continue; // old lease still open
    const { asset, facts } = bundle;
    const reading = facts.inspection ?? {
      condition: assetConditionSchema.parse(asset.condition),
      usageValue: asset.usage_value,
      hoursSinceService: null,
    };
    open.push({
      intakeId: intake.id,
      providerId: intake.providerId,
      item: {
        assetId: asset.id,
        category: assetCategorySchema.parse(asset.category),
        condition: reading.condition,
        usageUnit: usageUnitSchema.parse(asset.usage_unit),
        usageValue: reading.usageValue,
        modelYear: asset.model_year,
        listPriceCents: firstListPrice(lists, asset.id) ?? 0,
        hoursSinceService: reading.hoursSinceService,
      },
    });
  }
  return open;
}

/** Plans every open return and carries out the ones that can go ahead. */
export async function prepareReturnedItems(db: PrismaClient, today: string) {
  await finalizeDueReturns(db, today);
  const data = await planData();
  const open = await openReturns(db, data.lists);
  const plans = planNextLives(
    open.map((entry) => entry.item),
    { today, ...data }
  );

  let relisted = 0;
  for (const [index, plan] of plans.entries()) {
    const entry = open[index]!;
    if (!plan.ok) continue;
    const bundle = await loadIntake(db, entry.providerId, entry.intakeId);
    let revision = bundle.intake.revision;
    if (!bundle.facts.inspection) {
      revision = (
        await recordInspection(
          db,
          entry.providerId,
          entry.intakeId,
          {
            expectedRevision: revision,
            condition: entry.item.condition,
            usageValue: entry.item.usageValue,
            hoursSinceService: entry.item.hoursSinceService,
          },
          today
        )
      ).revision;
    }
    const done = new Set(bundle.facts.work.map((work) => work.actionId));
    for (const action of plan.chosen.actions) {
      if (done.has(action.id)) continue;
      revision = (
        await recordWork(
          db,
          entry.providerId,
          entry.intakeId,
          { expectedRevision: revision, actionId: action.id },
          today
        )
      ).revision;
    }
    await relist(
      db,
      entry.providerId,
      entry.intakeId,
      {
        expectedRevision: revision,
        nextLife: {
          priceCents: plan.chosen.priceCents,
          planJson: JSON.stringify(plan),
          listingMinimum: plan.listingMinimum,
        },
      },
      today
    );
    relisted += 1;
  }
  return { planned: plans.length, relisted };
}

/**
 * The plan to show on an item's page: the stored decision for a relisted item, or a fresh
 * plan (not carried out) for one still waiting. Null for items that never came back.
 */
export async function nextLifePlanFor(
  db: PrismaClient,
  assetId: string,
  today: string
): Promise<{ plan: NextLifePlan; relistedOn: string | null } | null> {
  const latest = await db.returnIntake.findFirst({
    where: { assetId },
    orderBy: [{ relistedOn: 'desc' }, { id: 'desc' }],
  });
  if (!latest) return null;
  if (latest.relistedOn && latest.nextLifePlanJson)
    return {
      plan: JSON.parse(latest.nextLifePlanJson) as NextLifePlan,
      relistedOn: latest.relistedOn,
    };
  if (latest.relistedOn) return null;
  const data = await planData();
  const open = await openReturns(db, data.lists);
  const plans = planNextLives(
    open.map((entry) => entry.item),
    { today, ...data }
  );
  const plan = plans.find((candidate) => candidate.assetId === assetId);
  return plan ? { plan, relistedOn: null } : null;
}
