import { loadAssets, loadCustomers } from '@/data/load';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';
import { DEMO_PROVIDERS, seedOwnerOf } from './providers';

/** The sign-in name for a seeded ID: "cust-aino" → "aino", "provider-kettu" → "kettu". */
const usernameOf = (id: string) => id.replace(/^(cust|provider)-/, '');

/**
 * Explicit synthetic owners/personas, not inferred attribution for old contracts. The
 * owners are the dealer-side demo providers (src/server/providers.ts) with the same IDs and
 * the same seed ownership, so both sides agree on who provides each item.
 */
export async function seedDemoParticipants(db: PrismaClient) {
  const [customers, packAssets] = await Promise.all([loadCustomers(), loadAssets()]);
  const seedOwners = new Map(packAssets.map((asset) => [asset.id, seedOwnerOf(asset)]));
  const users = [
    ...customers.map((customer) => ({
      id: customer.id,
      canonicalUsername: usernameOf(customer.id),
      displayName: customer.name,
    })),
    ...DEMO_PROVIDERS.filter((provider) => !customers.some((c) => c.id === provider.id)).map(
      (provider) => ({
        id: provider.id,
        canonicalUsername: usernameOf(provider.id),
        displayName: provider.displayName,
      })
    ),
  ];
  const existingUsers = await db.demoUser.findMany({
    select: { id: true, canonicalUsername: true },
  });
  const toCreate = users.filter(
    (user) =>
      !existingUsers.some(
        (row) => row.id === user.id || row.canonicalUsername === user.canonicalUsername
      )
  );
  const unowned = await db.asset.findMany({
    where: { ownerId: null },
    select: { id: true },
  });
  if (!toCreate.length && !unowned.length) return { usersCreated: 0, assetsAssigned: 0 };
  return withAudit(
    db,
    {
      actor: 'system:demo',
      action: 'demo_participants.seeded',
      entityType: 'demo',
      entityId: 'participants',
      details: {
        userIds: toCreate.map((user) => user.id),
        assetIds: unowned.map((asset) => asset.id),
      },
    },
    async (tx) => {
      for (const user of toCreate) await tx.demoUser.create({ data: user });
      let assetsAssigned = 0;
      for (const asset of unowned) {
        const desired = seedOwners.get(asset.id);
        if (!desired) continue;
        // Canonical username collisions are never resolved by stealing an existing account.
        if (!(await tx.demoUser.findUnique({ where: { id: desired } }))) continue;
        const result = await tx.asset.updateMany({
          where: { id: asset.id, ownerId: null },
          data: { ownerId: desired },
        });
        assetsAssigned += result.count;
      }
      return { usersCreated: toCreate.length, assetsAssigned };
    }
  );
}
