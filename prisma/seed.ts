// Fills the database from the data pack. Run by `npm run db:setup` (via `prisma db seed`).
// Safe to run again: it only adds assets that are missing and never overwrites your changes.
import { loadAssets } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { seedDealerSide } from '@/server/providers';
import { createPrismaClient } from '@/server/prisma-client';

const db = createPrismaClient();
try {
  const assets = await loadAssets();
  const { created, skipped } = await seedAssets(db, assets);
  console.log(`🌱 Seeded ${created} new assets (${skipped} were already there).`);
  const dealer = await seedDealerSide(db, assets);
  console.log(
    `🌱 Dealer side: ${dealer.providers} providers, ${dealer.ownership} ownership rows, ${dealer.intakes} imported returns.`
  );
} finally {
  await db.$disconnect();
}
