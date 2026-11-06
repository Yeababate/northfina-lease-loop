// Fills the database from the data pack. Run by `npm run db:setup` (via `prisma db seed`).
// Safe to run again: it only adds assets and bundles that are missing and never overwrites your changes.
import { loadAssets, loadBundleOffers, loadCoefficientTable } from '@/data/load';
import { availableTerms } from '@/domain/pricing';
import { seedBundleOffers } from '@/server/bundles';
import { seedAssets } from '@/server/assets';
import { seedModerator } from '@/server/moderator-seed';
import { seedDealerSide } from '@/server/providers';
import { createPrismaClient } from '@/server/prisma-client';
import { seedDemoParticipants } from '@/server/demo-participants';
import { seedWaitingList } from '@/server/waiting-list';

const db = createPrismaClient();
try {
  await seedModerator(db);
  await seedWaitingList(db);
  const assets = await loadAssets();
  const { created, skipped } = await seedAssets(db, assets);
  console.log(`🌱 Seeded ${created} new assets (${skipped} were already there).`);
  // Ownership first: each example bundle belongs to the provider of its items.
  const dealer = await seedDealerSide(db, assets);
  console.log(
    `🌱 Dealer side: ${dealer.providers} providers, ${dealer.ownership} ownership rows, ${dealer.intakes} imported returns.`
  );
  const [offers, table] = await Promise.all([loadBundleOffers(), loadCoefficientTable()]);
  const bundles = await seedBundleOffers(db, offers, availableTerms(table));
  console.log(
    `🌱 Seeded ${bundles.created} new bundles (${bundles.skipped} were already there, ${bundles.unowned} without a single provider, ${bundles.reowned} moved to their real provider).`
  );
  const participants = await seedDemoParticipants(db);
  console.log(
    `Seeded ${participants.usersCreated} demo users and assigned ${participants.assetsAssigned} unowned demo assets.`
  );
} finally {
  await db.$disconnect();
}
