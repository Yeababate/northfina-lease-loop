// Fills the database from the data pack. Run by `npm run db:setup` (via `prisma db seed`).
// Safe to run again: it only adds assets that are missing and never overwrites your changes.
import { loadAssets } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { seedModerator } from '@/server/moderator-seed';
import { seedDealerSide } from '@/server/providers';
import { createPrismaClient } from '@/server/prisma-client';
import { seedDemoParticipants } from '@/server/demo-participants';

const db = createPrismaClient();
try {
  await seedModerator(db);
  const assets = await loadAssets();
  const { created, skipped } = await seedAssets(db, assets);
  console.log(`🌱 Seeded ${created} new assets (${skipped} were already there).`);
  const dealer = await seedDealerSide(db, assets);
  console.log(
    `🌱 Dealer side: ${dealer.providers} providers, ${dealer.ownership} ownership rows, ${dealer.intakes} imported returns.`
  );
  const participants = await seedDemoParticipants(db);
  console.log(
    `Seeded ${participants.usersCreated} demo users and assigned ${participants.assetsAssigned} unowned demo assets.`
  );
} finally {
  await db.$disconnect();
}
