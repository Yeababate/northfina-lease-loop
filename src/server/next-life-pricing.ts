import type { Asset, CoefficientTable, PriceList, ResidualCurves } from '@/data/schemas';
import { marketAgeMonths, nextLifeListPriceCents } from '@/domain/market-value';
import { listPriceOn } from '@/domain/price-list';
import type { TransactionClient } from './audit';

export async function priceNextLife(
  tx: Pick<TransactionClient, 'contract'>,
  asset: Asset,
  today: string,
  {
    lists,
    curves,
    table,
  }: { lists: readonly PriceList[]; curves: ResidualCurves; table: CoefficientTable }
) {
  const basis = await nextLifeBasis(tx, asset, today, lists);
  if (!basis.ok) return basis;
  return nextLifeListPriceCents({ ...asset, ...basis.input }, curves, table);
}

export async function nextLifeBasis(
  tx: Pick<TransactionClient, 'contract'>,
  asset: Asset,
  today: string,
  lists: readonly PriceList[]
) {
  const first = await tx.contract.findFirst({
    where: { assetId: asset.id },
    orderBy: [{ startOn: 'asc' }, { signedOn: 'asc' }, { id: 'asc' }],
    select: { startOn: true, listPriceCents: true },
  });
  const referenceDate = `${asset.model_year}-07-01`;
  let firstLeaseListPriceCents = first?.listPriceCents;
  if (!first) {
    const referencePrice = listPriceOn(lists, asset.id, referenceDate);
    // Imported assets can predate all recorded lists. Use the earliest recorded net list price.
    firstLeaseListPriceCents = referencePrice.ok
      ? referencePrice.priceCents
      : lists
          .toSorted((a, b) => a.valid_from.localeCompare(b.valid_from))
          .find((list) => list.prices[asset.id] !== undefined)?.prices[asset.id];
  }
  if (firstLeaseListPriceCents === undefined)
    return { ok: false, reason: 'missing_reference_price' } as const;

  return {
    ok: true,
    input: {
      firstLeaseListPriceCents,
      ageMonths: marketAgeMonths(first?.startOn ?? null, asset.model_year, today),
    },
  } as const;
}
