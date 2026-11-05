// POST /api/notifications/read-all → marks all of the current customer's notifications read.
import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { markAllNotificationsRead } from '@/server/reminders/inbox';
import { requireRecipient } from '@/server/reminders/recipient';

export const POST = handleRoute(async () => {
  const recipientId = await requireRecipient();
  return ok(await markAllNotificationsRead(db, recipientId, new Date()));
});
