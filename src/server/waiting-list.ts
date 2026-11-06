import {
  loadCoefficientTable,
  loadPriceLists,
  loadRefurbishmentCosts,
  loadResidualCurves,
  loadSecondLifeDemand,
  loadVatRates,
} from '@/data/load';
import { assetConditionSchema, secondLifeRequestSchema } from '@/data/schemas';
import type { WaitingListEntry } from '@/generated/prisma/client';
import { marketValueCents } from '@/domain/market-value';
import { rankWaitingList, type WaitingEntry } from '@/domain/matchmaking';
import { currentState, isOnHold } from '@/domain/next-life';
import { decideRefurbishment } from '@/domain/refurbish-decision';
import { vatRateOn } from '@/domain/vat';
import { ApiError } from './api-response';
import { hasWaitingListReservation, toAsset } from './assets';
import { withAudit, type TransactionClient } from './audit';
import { nextLifeBasis } from './next-life-pricing';
import { loadIntake } from './next-life-reads';
import type { PrismaClient } from './prisma-client';

type Reader = PrismaClient | TransactionClient;

export async function seedWaitingList(db: PrismaClient) {
  const entries = await loadSecondLifeDemand();
  const existing = new Set(
    (await db.waitingListEntry.findMany({ select: { id: true } })).map((row) => row.id)
  );
  const missing = entries.filter((entry) => !existing.has(entry.id));
  if (missing.length === 0) return;
  await withAudit(
    db,
    {
      actor: 'seed',
      action: 'waiting_list.seeded',
      entityType: 'waiting_list',
      entityId: 'demo',
      details: { count: missing.length },
    },
    (tx) =>
      tx.waitingListEntry.createMany({
        data: missing.map((entry) => ({
          id: entry.id,
          category: entry.category,
          maxMonthlyNetRentCents: entry.max_monthly_net_rent_cents,
          minCondition: entry.min_condition,
          preferredTermMonths: entry.preferred_term_months,
          neededBy: entry.needed_by,
          signedUpOn: entry.signed_up_on,
          who: entry.who,
        })),
      })
  );
}

function toWaitingEntry(row: WaitingListEntry): WaitingEntry {
  const entry = secondLifeRequestSchema.parse({
    id: row.id,
    category: row.category,
    max_monthly_net_rent_cents: row.maxMonthlyNetRentCents,
    min_condition: row.minCondition,
    preferred_term_months: row.preferredTermMonths,
    needed_by: row.neededBy,
    signed_up_on: row.signedUpOn,
    who: row.who,
  });
  switch (row.status) {
    case 'waiting':
    case 'offered':
    case 'matched':
    case 'expired':
      return { ...entry, status: row.status };
    default:
      throw new Error('Unknown waiting-list status');
  }
}

async function loadMatchData() {
  const [lists, table, curves, rules, vat] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadResidualCurves(),
    loadRefurbishmentCosts(),
    loadVatRates(),
  ]);
  return { lists, table, curves, rules, vat };
}

async function proposeMatches(
  db: Reader,
  providerId: string,
  intakeId: string,
  today: string,
  data: Awaited<ReturnType<typeof loadMatchData>>
) {
  const { asset, facts } = await loadIntake(db, providerId, intakeId);
  const current = currentState(facts);
  if (
    !facts.inspection ||
    !current ||
    facts.relistedOn ||
    (asset.status !== 'returned' && !isOnHold(facts))
  )
    throw new ApiError(409, 'MATCH_NOT_READY', 'Inspect the returned item before matching it');
  return computeMatches(
    db,
    { asset, facts, current, hoursSinceService: facts.inspection.hoursSinceService },
    today,
    data
  );
}

/**
 * The refurbishment decision and waiting-list ranking for a returned item in a given state.
 * Shared by the provider's match proposal (after inspection) and the customer-facing preview
 * on the item page (secondLifePreview), so both always tell the same story.
 */
async function computeMatches(
  db: Reader,
  state: {
    asset: Awaited<ReturnType<typeof loadIntake>>['asset'];
    facts: Awaited<ReturnType<typeof loadIntake>>['facts'];
    current: NonNullable<ReturnType<typeof currentState>>;
    hoursSinceService: number | null;
  },
  today: string,
  data: Awaited<ReturnType<typeof loadMatchData>>
) {
  const { asset, facts, current } = state;
  // The pack does not include lead times. Work can be planned for today, or the old lease end if later.
  const readyOn = facts.lease && facts.lease.endOn > today ? facts.lease.endOn : today;
  const vat = vatRateOn(data.vat.rates, readyOn);
  const valueInput = await nextLifeBasis(db, toAsset(asset), readyOn, data.lists);
  if (!vat.ok || !valueInput.ok)
    throw new ApiError(422, 'MATCH_PRICE_UNAVAILABLE', 'This item cannot be priced for a match');

  const category = data.rules[facts.category];
  const recorded = new Set(facts.work.map((work) => work.actionId));
  const rules = {
    ...data.rules,
    [facts.category]: {
      ...category,
      fixed: category.fixed.filter((rule) => !recorded.has(rule.id)),
    },
  };
  const decision = decideRefurbishment(
    {
      ...current,
      category: facts.category,
      usageUnit: facts.usageUnit,
      hoursSinceService: state.hoursSinceService,
    },
    rules,
    ({ condition, usageValue }) => {
      const value = marketValueCents(
        {
          ...valueInput.input,
          category: facts.category,
          condition,
          usage: { unit: facts.usageUnit, value: usageValue },
        },
        data.curves
      );
      if (!value.ok)
        throw new ApiError(
          422,
          'MATCH_PRICE_UNAVAILABLE',
          'This item cannot be priced for a match'
        );
      return value.priceCents;
    },
    'fair'
  );
  const [entries, reserved] = await Promise.all([
    db.waitingListEntry
      .findMany({ orderBy: { id: 'asc' } })
      .then((rows) => rows.map(toWaitingEntry)),
    hasWaitingListReservation(db, asset.id, today),
  ]);
  return {
    assetId: asset.id,
    canAssign: asset.status === 'returned' && !isOnHold(facts) && !reserved,
    reserved,
    readyOn,
    decision,
    ...rankWaitingList(
      { category: facts.category, readyOn },
      decision.options,
      entries,
      today,
      data.table,
      vat.rate.rate_percent
    ),
  };
}

export async function getWaitingListMatches(
  db: PrismaClient,
  providerId: string,
  intakeId: string,
  today: string
) {
  return proposeMatches(db, providerId, intakeId, today, await loadMatchData());
}

export async function assignWaitingListEntry(
  db: PrismaClient,
  providerId: string,
  intakeId: string,
  entryId: string,
  today: string
) {
  const data = await loadMatchData();
  const details = { entryId, assetId: '', expiredOffers: 0 };
  return withAudit(
    db,
    {
      actor: providerId,
      action: 'return.waiting_list_offered',
      entityType: 'return',
      entityId: intakeId,
      details,
    },
    async (tx) => {
      const proposal = await proposeMatches(tx, providerId, intakeId, today, data);
      if (proposal.reserved)
        throw new ApiError(
          409,
          'ASSET_ALREADY_OFFERED',
          'This item already has a waiting-list offer'
        );
      const offer = proposal.ranked.find((candidate) => candidate.entry.id === entryId);
      if (!proposal.canAssign || !offer)
        throw new ApiError(409, 'MATCH_CHANGED', 'This waiting-list match is no longer available');
      const expired = await tx.waitingListEntry.updateMany({
        where: { offeredAssetId: proposal.assetId, status: 'offered', neededBy: { lt: today } },
        data: { status: 'expired', offeredAssetId: null },
      });
      const assigned = await tx.waitingListEntry.updateMany({
        where: { id: entryId, status: 'waiting' },
        data: {
          status: 'offered',
          offeredAssetId: proposal.assetId,
          offeredIntakeId: intakeId,
          offeredOn: today,
          offerJson: JSON.stringify({
            option: offer.option,
            monthlyNetCents: offer.monthlyNetCents,
            monthlyGrossCents: offer.monthlyGrossCents,
          }),
        },
      });
      if (assigned.count !== 1)
        throw new ApiError(409, 'MATCH_CHANGED', 'This waiting-list match is no longer available');
      Object.assign(details, { assetId: proposal.assetId, expiredOffers: expired.count });
      return { entryId, assetId: proposal.assetId, status: 'offered', offer } as const;
    }
  );
}

/**
 * Read-only: what happens next to a returned item, for its page (scenario card 9). Uses the
 * inspection when there is one, otherwise the condition and usage recorded at return. Null
 * when the item has no open return, or it cannot be priced yet.
 */
export async function secondLifePreview(db: PrismaClient, assetId: string, today: string) {
  const intake = await db.returnIntake.findFirst({
    where: { assetId, relistedOn: null },
    orderBy: { id: 'desc' },
  });
  if (!intake) return null;
  const { asset, facts } = await loadIntake(db, intake.providerId, intake.id).catch(() => ({
    asset: null,
    facts: null,
  }));
  if (!asset || !facts || facts.relistedOn) return null;
  const current = currentState(facts) ?? {
    condition: assetConditionSchema.parse(asset.condition),
    usageValue: asset.usage_value,
  };
  try {
    const matches = await computeMatches(
      db,
      { asset, facts, current, hoursSinceService: facts.inspection?.hoursSinceService ?? null },
      today,
      await loadMatchData()
    );
    return { ...matches, fromCondition: current.condition };
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
}

export type SecondLifeNote = {
  /** The condition and counter it came back with (or was inspected at). */
  fromCondition: string;
  recommendation: { optionId: string | null; reason: string };
  /** What is done for the first person in line, or null when nobody fits. */
  plan: {
    toCondition: string;
    work: { id: string; costCents: number }[];
    costCents: number;
    priceCents: number | null;
  } | null;
  winner: { id: string; who: string; termMonths: number; monthlyNetCents: number } | null;
  /** Same-category people who did not get it, and why. */
  others: { id: string; who: string; reason: string }[];
};

/** The second-life preview as plain data for the item page's read-only note (card 9). */
export async function secondLifeNote(
  db: PrismaClient,
  assetId: string,
  today: string
): Promise<SecondLifeNote | null> {
  const preview = await secondLifePreview(db, assetId, today);
  if (!preview) return null;
  const who = new Map(
    (await db.waitingListEntry.findMany({ select: { id: true, who: true } })).map((row) => [
      row.id,
      row.who,
    ])
  );
  const winner = preview.ranked[0];
  const option = winner?.option ?? null;
  return {
    fromCondition: preview.fromCondition,
    recommendation: preview.decision.recommendation,
    plan: option
      ? {
          toCondition: option.after.condition,
          work: option.work.map((step) => ({ id: step.action.id, costCents: step.costCents })),
          costCents: option.costCents,
          priceCents: option.marketValueCents,
        }
      : null,
    winner: winner
      ? {
          id: winner.entry.id,
          who: winner.entry.who,
          termMonths: winner.entry.preferred_term_months,
          monthlyNetCents: winner.monthlyNetCents,
        }
      : null,
    others: [
      ...preview.ranked.slice(1).map((offer) => ({
        id: offer.entry.id,
        who: offer.entry.who,
        reason: `lost:${offer.rankReason}`,
      })),
      ...preview.rejected
        .filter((rejected) => rejected.reason !== 'wrong_category')
        .map((rejected) => ({
          id: rejected.entryId,
          who: who.get(rejected.entryId) ?? rejected.entryId,
          reason: rejected.reason,
        })),
    ],
  };
}
