// One-time repair, run at server start: reminders saved before recipients were participant ids
// were keyed by the typed sign-in name ("Liv Bertani-Green"). Each such name is matched to its
// participant the same way sign-in does (demoParticipantName: trimmed, case-insensitive), and
// its settings, planned reminders, notifications and read receipts are moved to that id.
// Safe to run again; names that match nobody are left unchanged rather than guessed at. If a
// lease already has settings under the id, the old name's settings for that lease are kept
// as they are, so nothing is overwritten.
import { demoParticipantName } from '@/domain/demo-participant';
import { withAudit } from '../audit';
import type { PrismaClient } from '../prisma-client';

export async function adoptNamedReminderRecipients(db: PrismaClient): Promise<number> {
  const users = await db.demoUser.findMany({ select: { id: true, canonicalUsername: true } });
  const ids = new Set(users.map((user) => user.id));
  const byUsername = new Map(users.map((user) => [user.canonicalUsername, user.id]));

  const [preferences, occurrences, notifications, receipts] = await Promise.all([
    db.reminderPreference.findMany({ select: { recipientId: true }, distinct: ['recipientId'] }),
    db.reminderOccurrence.findMany({ select: { recipientId: true }, distinct: ['recipientId'] }),
    db.notification.findMany({ select: { recipientId: true }, distinct: ['recipientId'] }),
    db.notificationReceipt.findMany({ select: { recipientId: true }, distinct: ['recipientId'] }),
  ]);
  const legacy = new Set(
    [...preferences, ...occurrences, ...notifications, ...receipts]
      .map((row) => row.recipientId)
      .filter((recipientId) => !ids.has(recipientId))
  );

  let moved = 0;
  for (const name of legacy) {
    const parsed = demoParticipantName(name);
    const userId = parsed.ok ? byUsername.get(parsed.canonicalUsername) : undefined;
    if (!userId) continue;
    await withAudit(
      db,
      {
        actor: 'system:reminder-recipients',
        action: 'reminder.recipient_adopted',
        entityType: 'demo_user',
        entityId: userId,
        details: { fromName: name },
      },
      async (tx) => {
        const taken = new Set(
          (
            await tx.reminderPreference.findMany({
              where: { recipientId: userId },
              select: { contractId: true },
            })
          ).map((row) => row.contractId)
        );
        const free = { recipientId: name, contractId: { notIn: [...taken] } };
        await tx.reminderPreference.updateMany({ where: free, data: { recipientId: userId } });
        await tx.reminderOccurrence.updateMany({ where: free, data: { recipientId: userId } });
        await tx.notification.updateMany({ where: free, data: { recipientId: userId } });
        await tx.notificationReceipt.updateMany({
          where: { recipientId: name, notification: { recipientId: userId } },
          data: { recipientId: userId },
        });
      }
    );
    moved += 1;
  }
  return moved;
}
