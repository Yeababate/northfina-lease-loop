// Loads what fair-exit-v2 needs for one contract (src/domain/fair-exit.ts): the band's annual
// interest rate, the VAT rates, and the facts to value the returned items. The pricing itself
// stays in the domain; this file only reads.
import { loadCoefficientTable, loadResidualCurves, loadVatRates } from '@/data/load';
import { assetConditionSchema } from '@/data/schemas';
import type { ExitPricing } from '@/domain/early-exit';
import { valueReturnedItems, type ReturnedItem } from '@/domain/fair-exit-valuation';
import { toAsset } from './assets';
import type { TransactionClient } from './audit';
import type { PrismaClient } from './prisma-client';

type Reader = PrismaClient | TransactionClient;

export async function loadExitPricing(
  db: Reader,
  contract: { id: string; band: string; coefficientVersion: number },
  assetIds: readonly string[]
): Promise<ExitPricing> {
  const [table, curves, vat, items] = await Promise.all([
    loadCoefficientTable(),
    loadResidualCurves(),
    loadVatRates(),
    Promise.all(assetIds.map((assetId) => returnedItem(db, contract.id, assetId))),
  ]);
  // The rate belongs to the coefficient table the contract was priced with.
  const band =
    table.version === contract.coefficientVersion
      ? table.bands.find((row) => row.band === contract.band)
      : undefined;
  const known = items.filter((item): item is ReturnedItem => item !== null);
  return {
    annualInterestPercent: band?.annual_interest_percent ?? null,
    vatRates: vat.rates,
    valueReturn: (on) =>
      known.length === items.length
        ? valueReturnedItems(known, on, curves)
        : { ok: false, reason: 'market_value_unavailable' },
  };
}

/** The item's recorded state, any inspection from this lease's return, and its first lease. */
async function returnedItem(
  db: Reader,
  contractId: string,
  assetId: string
): Promise<ReturnedItem | null> {
  const [row, first, inspection] = await Promise.all([
    db.asset.findUnique({ where: { id: assetId } }),
    db.contract.findFirst({
      where: { OR: [{ assetId }, { lines: { some: { assetId } } }] },
      orderBy: [{ startOn: 'asc' }, { signedOn: 'asc' }, { id: 'asc' }],
      select: { startOn: true, listPriceCents: true, lines: { where: { assetId } } },
    }),
    db.returnInspection.findFirst({
      where: { intake: { assetId, contractId } },
      orderBy: [{ inspectedOn: 'desc' }, { createdAt: 'desc' }],
    }),
  ]);
  if (!row || !first) return null;
  const asset = toAsset(row);
  // A bundle line carries the item's own list price; a single-item contract carries it whole.
  const listPriceCents = first.lines[0]?.listPriceCents ?? first.listPriceCents;
  return {
    assetId,
    category: asset.category,
    modelYear: asset.model_year,
    recordedCondition: asset.condition,
    usage: asset.usage,
    inspection: inspection
      ? {
          condition: assetConditionSchema.parse(inspection.condition),
          usageValue: inspection.usageValue,
        }
      : null,
    firstLeaseStartOn: first.startOn,
    firstLeaseListPriceCents: listPriceCents,
  };
}
