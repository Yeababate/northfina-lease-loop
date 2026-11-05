// POST /api/notifications/:id/read → marks one of the current customer's notifications read.
import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { markNotificationRead } from '@/server/reminders/inbox';
import { requireRecipient } from '@/server/reminders/recipient';

export const POST = handleRoute(
  async (_request, { params }: RouteContext<'/api/notifications/[id]/read'>) => {
    const { id } = await params;
    const recipientId = await requireRecipient();
    return ok(await markNotificationRead(db, id, recipientId, new Date()));
  }
);
