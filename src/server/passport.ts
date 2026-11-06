// Read adapter for an item's passport (src/domain/item-passport.ts): its recorded lifecycle
// events and the leases signed for it. Nothing personal: no renter names or contract ids.
import { buildPassport, type Passport } from '@/domain/item-passport';
import type { PrismaClient } from './prisma-client';

export async function loadPassport(db: PrismaClient, assetId: string): Promise<Passport | null> {
  const asset = await db.asset.findUnique({
    where: { id: assetId },
    select: { model_year: true, previous_lives: true },
  });
  if (!asset) return null;
  const [events, contracts] = await Promise.all([
    db.assetLifecycleEvent.findMany({ where: { assetId }, orderBy: { id: 'asc' } }),
    db.contract.findMany({
      where: { OR: [{ assetId }, { lines: { some: { assetId } } }] },
      select: { startOn: true, termMonths: true },
      orderBy: { startOn: 'asc' },
    }),
  ]);
  return buildPassport({
    modelYear: asset.model_year,
    previousLives: asset.previous_lives,
    leases: contracts,
    events: events.map((event) => ({
      type: event.type,
      on: event.on,
      details: event.detailsJson === null ? null : (JSON.parse(event.detailsJson) as unknown),
    })),
  });
}
