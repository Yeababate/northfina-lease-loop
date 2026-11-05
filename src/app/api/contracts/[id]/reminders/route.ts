// GET /api/contracts/:id/reminders  → the current customer's own reminder settings and
//                                     saved schedule for that lease (404 for anyone else).
// PUT /api/contracts/:id/reminders  body: { expectedRevision, preferences, locale? }
//     Saves edited settings. A stale revision is 409; only future, unsent reminders move.
import { z } from 'zod';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import {
  getReminderSettings,
  reminderLocaleSchema,
  reminderPreferencesSchema,
  updateReminderSettings,
} from '@/server/reminders/preferences';
import { requireRecipient } from '@/server/reminders/recipient';

const bodySchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  preferences: reminderPreferencesSchema,
  locale: reminderLocaleSchema.optional(),
});

export const GET = handleRoute(
  async (_request, { params }: RouteContext<'/api/contracts/[id]/reminders'>) => {
    const { id } = await params;
    const recipientId = await requireRecipient();
    return ok(await getReminderSettings(db, id, recipientId));
  }
);

export const PUT = handleRoute(
  async (request, { params }: RouteContext<'/api/contracts/[id]/reminders'>) => {
    const { id } = await params;
    const recipientId = await requireRecipient();
    const body = await readJsonBody(request, bodySchema);
    return ok(
      await updateReminderSettings(db, { contractId: id, recipientId, ...body }, new Date())
    );
  }
);
