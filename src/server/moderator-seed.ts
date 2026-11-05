import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';

/** Trusted demo capability, never accepted from a browser role field. */
export async function seedModerator(db: PrismaClient) {
  const existing = await db.demoUser.findUnique({ where: { canonicalUsername: 'moderator' } });
  if (existing?.moderator) return existing;
  const id = existing?.id ?? 'demo-moderator';
  return withAudit(
    db,
    { actor: 'seed', action: 'demo_user.moderator_seeded', entityType: 'demo_user', entityId: id },
    (tx) =>
      tx.demoUser.upsert({
        where: { canonicalUsername: 'moderator' },
        create: { id, canonicalUsername: 'moderator', displayName: 'Moderator', moderator: true },
        update: { moderator: true },
      })
  );
}
