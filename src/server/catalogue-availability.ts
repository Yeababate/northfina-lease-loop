// When each catalogue item can be leased (#72). Reads the leases of items that are not
// available and hands their ends to the pure rules in src/domain/catalogue-availability.ts.
import type { Asset } from '@/data/schemas';
import {
  availabilityOf,
  currentLeaseEndOn,
  type Availability,
  type LeaseEnd,
} from '@/domain/catalogue-availability';
import type { PrismaClient } from './prisma-client';

/** Availability of every given asset, by asset id. One query, only for unavailable items. */
export async function availabilityForAssets(
  db: PrismaClient,
  assets: readonly Pick<Asset, 'id' | 'status'>[],
  today: string
): Promise<Map<string, Availability>> {
  const waiting = assets.filter((asset) => asset.status !== 'available').map((asset) => asset.id);
  const rows =
    waiting.length === 0
      ? []
      : await db.contract.findMany({
          where: { assetId: { in: waiting } },
          select: { assetId: true, endOn: true, lifecycle: { select: { actualEndOn: true } } },
        });
  const leases = new Map<string, LeaseEnd[]>();
  for (const row of rows) {
    const list = leases.get(row.assetId) ?? [];
    list.push({ endOn: row.endOn, actualEndOn: row.lifecycle?.actualEndOn ?? null });
    leases.set(row.assetId, list);
  }
  return new Map(
    assets.map((asset) => [
      asset.id,
      availabilityOf(asset, currentLeaseEndOn(leases.get(asset.id) ?? []), today),
    ])
  );
}
