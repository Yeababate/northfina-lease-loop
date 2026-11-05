// Fills the database from the data pack. Run by `npm run db:setup` (via `prisma db seed`).
// Safe to run again: it only adds assets and bundles that are missing and never overwrites your changes.
import { loadAssets, loadBundleOffers, loadCoefficientTable } from '@/data/load';
import { availableTerms } from '@/domain/pricing';
import { seedAssets } from '@/server/assets';
import { seedBundleOffers } from '@/server/bundles';
import { createPrismaClient } from '@/server/prisma-client';

const db = createPrismaClient();
try {
  const { created, skipped } = await seedAssets(db, await loadAssets());
  console.log(`🌱 Seeded ${created} new assets (${skipped} were already there).`);
  const [offers, table] = await Promise.all([loadBundleOffers(), loadCoefficientTable()]);
  const bundles = await seedBundleOffers(db, offers, availableTerms(table));
  console.log(`🌱 Seeded ${bundles.created} new bundles (${bundles.skipped} were already there).`);
} finally {
  await db.$disconnect();
}
