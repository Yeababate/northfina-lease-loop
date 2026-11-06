// GET /api/notifications → the current customer's own inbox, newest first, with the
// unread count. Reading the list never marks anything read.
import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { listInbox } from '@/server/reminders/inbox';
import { requireRecipient } from '@/server/reminders/recipient';

export const GET = handleRoute(async () => {
  const recipientId = await requireRecipient();
  return ok(await listInbox(db, recipientId, new Date()));
});
