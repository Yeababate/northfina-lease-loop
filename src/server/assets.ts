// Reading and changing assets in the database. Rows are converted to the same `Asset`
// shape as data/assets.json, so the UI and domain code see one type everywhere.
import type { Asset as AssetRow, PrismaClient } from '@/generated/prisma/client';
import { assetSchema, type Asset, type AssetCategory, type AssetStatus } from '@/data/schemas';
import type { PriceOverride } from '@/domain/price-list';
import { ApiError } from './api-response';
import { withAudit, type TransactionClient } from './audit';
import { todayIso } from './today';

/** Database row → data-pack shape. Validates, so a bad value edited in by hand is caught. */
export function toAsset(row: AssetRow): Asset {
  return assetSchema.parse({
    id: row.id,
    category: row.category,
    make: row.make,
    model: row.model,
    model_year: row.model_year,
    serial_number: row.serial_number,
    condition: row.condition,
    usage: { unit: row.usage_unit, value: row.usage_value },
    previous_lives: row.previous_lives,
    status: row.status,
  });
}

/** Data-pack shape → columns for a new database row. */
export function toAssetRowData(asset: Asset) {
  return {
    id: asset.id,
    category: asset.category,
    make: asset.make,
    model: asset.model,
    model_year: asset.model_year,
    serial_number: asset.serial_number,
    condition: asset.condition,
    usage_unit: asset.usage.unit,
    usage_value: asset.usage.value,
    previous_lives: asset.previous_lives,
    status: asset.status,
  };
}

export async function listAssets(
  db: PrismaClient,
  filter: { category?: AssetCategory } = {}
): Promise<Asset[]> {
  const rows = await db.asset.findMany({
    where: filter.category ? { category: filter.category } : {},
    orderBy: { id: 'asc' },
  });
  return rows.map(toAsset);
}

/** One asset by id, or null when there is no such asset. */
export async function getAsset(db: PrismaClient, id: string): Promise<Asset | null> {
  const row = await db.asset.findUnique({ where: { id } });
  return row ? toAsset(row) : null;
}

export function assetPriceOverride(
  row: Pick<AssetRow, 'nextLifePriceCents' | 'nextLifePricedOn'>
): PriceOverride | undefined {
  return row.nextLifePriceCents !== null && row.nextLifePricedOn !== null
    ? { priceCents: row.nextLifePriceCents, pricedOn: row.nextLifePricedOn }
    : undefined;
}

export async function hasWaitingListReservation(
  db: Pick<TransactionClient, 'waitingListEntry'>,
  assetId: string,
  today: string
) {
  return (
    (await db.waitingListEntry.count({
      where: {
        offeredAssetId: assetId,
        OR: [{ status: 'matched' }, { status: 'offered', neededBy: { gte: today } }],
      },
    })) !== 0
  );
}

export type ChangeAssetStatusResult =
  { ok: true; asset: Asset } | { ok: false; reason: 'not_found' };

/** Sets an asset's status and writes `asset.status_changed` to the audit log, atomically. */
export async function changeAssetStatus(
  db: PrismaClient,
  input: { id: string; status: AssetStatus; actor: string }
): Promise<ChangeAssetStatusResult> {
  const existing = await db.asset.findUnique({ where: { id: input.id } });
  if (!existing) return { ok: false, reason: 'not_found' };

  const updated = await withAudit(
    db,
    {
      actor: input.actor,
      action: 'asset.status_changed',
      entityType: 'asset',
      entityId: input.id,
      details: { from: existing.status, to: input.status },
    },
    async (tx) => {
      if (
        input.status !== 'returned' &&
        (await hasWaitingListReservation(tx, input.id, todayIso()))
      )
        throw new ApiError(
          409,
          'ASSET_ALREADY_OFFERED',
          'This item is reserved for a waiting-list entry'
        );
      return tx.asset.update({ where: { id: input.id }, data: { status: input.status } });
    }
  );
  return { ok: true, asset: toAsset(updated) };
}

/** Inserts assets that are not in the database yet. Never overwrites changes you made. */
export async function seedAssets(
  db: PrismaClient,
  assets: readonly Asset[]
): Promise<{ created: number; skipped: number }> {
  const existing = await db.asset.findMany({ select: { id: true } });
  const existingIds = new Set(existing.map((row) => row.id));
  const missing = assets.filter((asset) => !existingIds.has(asset.id));
  if (missing.length > 0) {
    await db.asset.createMany({ data: missing.map(toAssetRowData) });
  }
  return { created: missing.length, skipped: assets.length - missing.length };
}
