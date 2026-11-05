// GET /api/notifications/:id → one of the current customer's notifications with its
// simulated channel artifacts (the saved email preview). Someone else's is 404.
import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { getNotification } from '@/server/reminders/inbox';
import { requireRecipient } from '@/server/reminders/recipient';

export const GET = handleRoute(
  async (_request, { params }: RouteContext<'/api/notifications/[id]'>) => {
    const { id } = await params;
    const recipientId = await requireRecipient();
    return ok(await getNotification(db, id, recipientId, new Date()));
  }
);
