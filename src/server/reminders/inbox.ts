// A recipient's own reminder inbox. Reading never generates or marks anything: the
// worker generates notifications, and only an explicit open/mark-read changes read state.
// Every query is scoped to the recipient, so one user can never see or mark another's.
import { timeRemaining, type TimeRemaining } from '@/domain/reminder-timing';
import { ApiError } from '../api-response';
import { withAudit } from '../audit';
import type { PrismaClient } from '../prisma-client';

type NotificationRow = Awaited<ReturnType<PrismaClient['notification']['findFirstOrThrow']>> & {
  receipt: { readAt: Date | null } | null;
};

function view(row: NotificationRow, now: Date) {
  return {
    id: row.id,
    kind: row.kind,
    contractId: row.contractId,
    endOn: row.endOn,
    deadlineAt: row.deadlineAt.toISOString(),
    timeZone: row.timeZone,
    generatedAt: row.generatedAt.toISOString(),
    originalDueAt: row.originalDueAt.toISOString(),
    catchUp: row.catchUp,
    /** Time left when it was generated (history). */
    timingAtGeneration: JSON.parse(row.timingJson) as TimeRemaining,
    /** Time left right now: show this, so an old unread reminder is never stale. */
    timingNow: timeRemaining(now.toISOString(), row.deadlineAt.toISOString(), row.timeZone),
    payload: JSON.parse(row.payloadJson) as {
      itemName: string;
      assetId: string;
      actionPath: string;
    },
    locale: row.locale,
    readAt: row.receipt?.readAt?.toISOString() ?? null,
  };
}

/** Newest first, with the unread count. `limit` keeps the response small. */
export async function listInbox(db: PrismaClient, recipientId: string, now: Date, limit = 50) {
  const [rows, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { recipientId },
      include: { receipt: true },
      orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      take: limit,
    }),
    db.notificationReceipt.count({ where: { recipientId, readAt: null } }),
  ]);
  return { unreadCount, items: rows.map((row) => view(row, now)) };
}

/** One of the recipient's notifications with its simulated channel artifacts, or 404. */
export async function getNotification(
  db: PrismaClient,
  id: string,
  recipientId: string,
  now: Date
) {
  const row = await db.notification.findFirst({
    where: { id, recipientId },
    include: { receipt: true, deliveries: { orderBy: { channel: 'asc' } } },
  });
  if (!row) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  return {
    ...view(row, now),
    deliveries: row.deliveries.map((d) => ({
      channel: d.channel,
      /** Always "simulated": a saved preview is not an email that left the app. */
      mode: d.mode,
      status: d.status,
      locale: d.locale,
      toAddress: d.toAddress,
      subject: d.subject,
      bodyText: d.bodyText,
      createdAt: d.createdAt.toISOString(),
    })),
  };
}

/** Marks one of the recipient's own notifications read. Reading it again is a no-op. */
export async function markNotificationRead(
  db: PrismaClient,
  id: string,
  recipientId: string,
  now: Date
) {
  const receipt = await db.notificationReceipt.findFirst({
    where: { notificationId: id, recipientId },
  });
  if (!receipt) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  if (receipt.readAt) return { id, readAt: receipt.readAt.toISOString() };
  await withAudit(
    db,
    { actor: recipientId, action: 'notification.read', entityType: 'notification', entityId: id },
    (tx) =>
      tx.notificationReceipt.updateMany({
        where: { notificationId: id, recipientId, readAt: null },
        data: { readAt: now },
      })
  );
  return { id, readAt: now.toISOString() };
}

/** Marks all of the recipient's unread notifications read, nobody else's. */
export async function markAllNotificationsRead(db: PrismaClient, recipientId: string, now: Date) {
  const marked = await withAudit(
    db,
    {
      actor: recipientId,
      action: 'notification.read_all',
      entityType: 'recipient',
      entityId: recipientId,
    },
    async (tx) =>
      (
        await tx.notificationReceipt.updateMany({
          where: { recipientId, readAt: null },
          data: { readAt: now },
        })
      ).count
  );
  return { marked };
}
