// Readiness badges for the catalogue and remembered sets for the application pages (#52).
// Thin wrappers over #51's readinessForAssets and listSavedProfiles, so pages stay small.
import type { Question } from '@/data/schemas';
import type { RememberedSetView } from '@/domain/remembered-answers';
import { readinessForAssets, type ItemReadiness } from './lease-readiness';
import type { PrismaClient } from './prisma-client';
import { loadReadinessData } from './readiness-request';
import { listSavedProfiles } from './saved-answers';

export type CatalogueReadiness = {
  /** The set the badges were worked out for; null when the user has saved nothing yet. */
  profileKey: string | null;
  byAssetId: Map<string, ItemReadiness>;
};

/**
 * Readiness of the shown items for a signed-in user, for the catalogue's term and no down
 * payment (the catalogue has no down payment choice; the item page follows its slider).
 */
export async function catalogueReadiness(
  db: PrismaClient,
  userId: string,
  assetIds: readonly string[],
  termMonths: number,
  today: string
): Promise<CatalogueReadiness> {
  if (assetIds.length === 0) return { profileKey: null, byAssetId: new Map() };
  const result = await readinessForAssets(
    db,
    userId,
    { assetIds, termMonths, downPaymentCents: 0, profileKey: null },
    today,
    await loadReadinessData()
  );
  return {
    profileKey: result.profileKey,
    byAssetId: new Map(result.items.map((item) => [item.assetId, item])),
  };
}

/** The user's remembered sets for the browser, newest first; null when signed out. */
export async function rememberedSetsFor(
  db: PrismaClient,
  userId: string | null,
  questions: readonly Question[],
  today: string
): Promise<RememberedSetView[] | null> {
  if (userId === null) return null;
  const profiles = await listSavedProfiles(db, userId, questions, today);
  return profiles.map(({ profileKey, answers, flags }) => ({ profileKey, answers, flags }));
}
