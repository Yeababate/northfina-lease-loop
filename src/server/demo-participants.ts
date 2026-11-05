import { loadCustomers } from '@/data/load';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';

/** Explicit synthetic owners/personas, not inferred attribution for old contracts. */
export async function seedDemoParticipants(db: PrismaClient) {
  const customers = await loadCustomers();
  const users = [
    ...customers.map((customer) => ({
      id: customer.id,
      canonicalUsername: customer.id.replace(/^cust-/, ''),
      displayName: customer.name,
    })),
    { id: 'provider-north', canonicalUsername: 'provider1', displayName: 'Loop North' },
    { id: 'provider-south', canonicalUsername: 'provider2', displayName: 'Loop South' },
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
    select: { id: true, category: true },
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
        const desired =
          asset.id === 'laptop-002'
            ? 'cust-aino'
            : asset.category === 'farm_machine'
              ? 'provider-south'
              : 'provider-north';
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
