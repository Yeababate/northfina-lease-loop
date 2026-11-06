// Lease readiness of catalogue items for the signed-in user's remembered answers (#51).
// Items are priced exactly as signing prices them (priceContract with the item's discount
// rules and next-life price, VAT on the start day), so "ready" means what signing will see.
import type { CoefficientTable, PriceList, Question, VatRates } from '@/data/schemas';
import type { Answers } from '@/domain/answer-check';
import type { ProfileKey } from '@/domain/answer-scope';
import { priceContract } from '@/domain/contract-pricing';
import { leaseReadiness, type Readiness, type ReadinessItem } from '@/domain/lease-readiness';
import { vatCents, vatRateOn } from '@/domain/vat';
import { assetPriceOverride, toAsset } from './assets';
import { rulesForAsset } from './discount-rules';
import type { PrismaClient } from './prisma-client';
import { savedAnswersFor } from './saved-answers';
import { activePlacement } from './waiting-list-placement';

export type ReadinessData = {
  lists: readonly PriceList[];
  table: CoefficientTable;
  vatRates: VatRates;
  questions: readonly Question[];
};

export type ReadinessQuery = {
  assetIds: readonly string[];
  termMonths: number;
  downPaymentCents: number;
  /** The set to evaluate; the most recently changed one when left out. */
  profileKey: ProfileKey | null;
};

export type ItemReadiness = { assetId: string } & (Readiness | { status: 'not_found' });

async function readinessItem(
  db: PrismaClient,
  assetId: string,
  userId: string | null,
  query: ReadinessQuery,
  today: string,
  data: ReadinessData
): Promise<ReadinessItem | null> {
  const row = await db.asset.findUnique({ where: { id: assetId } });
  if (!row) return null;
  const asset = toAsset(row);
  if (asset.status !== 'available') return { ok: false, problem: 'not_available' };
  const placement = await activePlacement(db, assetId, today);
  if (
    placement
      ? !userId ||
        placement.participantId !== userId ||
        placement.preferredTermMonths !== query.termMonths
      : asset.condition === 'fair' || asset.condition === 'poor'
  )
    return { ok: false, problem: 'not_available' };
  const priced = priceContract(
    data.lists,
    data.table,
    { assetId, termMonths: query.termMonths, downPaymentCents: query.downPaymentCents },
    today,
    await rulesForAsset(db, assetId),
    assetPriceOverride(row)
  );
  const vat = vatRateOn(data.vatRates.rates, today);
  if (!priced.ok || !vat.ok) return { ok: false, problem: 'not_priceable' };
  const net = priced.price.monthlyNetCents;
  if (placement && net > placement.maxMonthlyNetRentCents)
    return { ok: false, problem: 'not_priceable' };
  return {
    ok: true,
    deal: {
      category: asset.category,
      financedAmountCents: priced.price.financedCents,
      termMonths: query.termMonths,
      startDate: today,
    },
    monthlyRentWithVatCents: net + vatCents(net, vat.rate.rate_percent),
  };
}

/**
 * Readiness of each requested item, in request order. Signed out (`userId` null) or with
 * no remembered set, every applicable question is reported missing.
 */
export async function readinessForAssets(
  db: PrismaClient,
  userId: string | null,
  query: ReadinessQuery,
  today: string,
  data: ReadinessData
): Promise<{ profileKey: string | null; items: ItemReadiness[] }> {
  const saved = userId
    ? await savedAnswersFor(db, userId, query.profileKey, data.questions, today)
    : null;
  const savedAnswers: Answers = saved?.answers ?? {};
  const items: ItemReadiness[] = [];
  for (const assetId of query.assetIds) {
    const item = await readinessItem(db, assetId, userId, query, today, data);
    if (!item) {
      items.push({ assetId, status: 'not_found' });
      continue;
    }
    items.push({
      assetId,
      ...leaseReadiness({
        savedAnswers,
        item,
        questions: data.questions,
        coefficientTable: data.table,
      }),
    });
  }
  return { profileKey: saved?.profileKey ?? null, items };
}
