// Read adapter for a lease's "Activity" section: the audit rows about one contract, its
// early-end requests and its ratings, described by leaseActivity (src/domain/lease-activity.ts).
// Only call this for someone allowed to see the contract (getParticipantContract checks that).
// A rating a moderator hid stays out unless the viewer wrote it.
import { leaseActivity, type ActivityItem, type ActivityViewer } from '@/domain/lease-activity';
import type { PrismaClient } from './prisma-client';

export async function loadLeaseActivity(
  db: PrismaClient,
  contractId: string,
  viewer: ActivityViewer
): Promise<ActivityItem[]> {
  const [exits, ratings] = await Promise.all([
    db.exitRequest.findMany({ where: { contractId }, select: { id: true } }),
    db.rating.findMany({
      where: { contractId },
      select: { id: true, reviewerId: true, visibility: true },
    }),
  ]);
  const ratingIds = ratings
    .filter((rating) => rating.visibility === 'visible' || rating.reviewerId === viewer.id)
    .map((rating) => rating.id);

  const rows = await db.auditLog.findMany({
    where: {
      OR: [
        { entity_type: 'contract', entity_id: contractId },
        { entity_type: 'exit', entity_id: { in: exits.map((exit) => exit.id) } },
        { entity_type: 'rating', entity_id: { in: ratingIds } },
      ],
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  });

  const actorIds = [...new Set(rows.map((row) => row.actor))];
  const [users, providers] = await Promise.all([
    db.demoUser.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, displayName: true },
    }),
    db.provider.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, displayName: true },
    }),
  ]);
  const names = new Map<string, string>([
    ...users.map((user) => [user.id, user.displayName] as const),
    ...providers.map((provider) => [provider.id, provider.displayName] as const),
  ]);

  return leaseActivity(
    rows.map((row) => ({
      id: row.id,
      created_at: row.created_at.toISOString(),
      actor: row.actor,
      action: row.action,
      details: row.details_json === null ? null : (JSON.parse(row.details_json) as unknown),
    })),
    viewer,
    names
  );
}
