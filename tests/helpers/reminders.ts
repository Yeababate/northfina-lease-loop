// Fixtures for reminder tests: a signed lease with saved reminder preferences, written
// through the real audited service. The price fields are fixed sample values.
import {
  defaultReminderPreferences,
  type ReminderPreferences,
} from '@/domain/reminder-preferences';
import { withAudit } from '@/server/audit';
import type { PrismaClient } from '@/server/prisma-client';
import {
  createReminderPreferencesInTx,
  validateReminderSetup,
} from '@/server/reminders/preferences';
import type { Locale } from '@/i18n/locales';

export async function seedLease(
  db: PrismaClient,
  options: {
    id: string;
    endOn: string;
    recipientId?: string;
    preferences?: ReminderPreferences;
    savedAt: Date;
    locale?: Locale;
    assetId?: string;
  }
) {
  const recipientId = options.recipientId ?? 'cust-aino';
  const assetId = options.assetId ?? 'ebike-003';
  const event = { contractId: options.id, recipientId, endOn: options.endOn };
  const preferences = options.preferences ?? defaultReminderPreferences('Europe/Helsinki');
  const setup = validateReminderSetup(event, preferences, options.savedAt);
  await withAudit(
    db,
    { actor: 'test', action: 'contract.signed', entityType: 'contract', entityId: options.id },
    async (tx) => {
      await tx.contract.create({
        data: {
          id: options.id,
          actor: 'Aino Virtanen',
          assetId,
          startOn: '2025-12-05',
          endOn: options.endOn,
          signedOn: '2025-12-05',
          termMonths: 12,
          downPaymentCents: 0,
          listPriceCents: 389000,
          priceListVersion: 1,
          coefficientVersion: 1,
          coefficientId: 'test',
          band: 'B',
          factor: 0.05,
          financedCents: 389000,
          monthlyNetCents: 19450,
          buyoutNetCents: 58350,
        },
      });
      await createReminderPreferencesInTx(
        tx,
        event,
        { recipientId, locale: options.locale ?? 'en', preferences: setup.preferences },
        setup.schedule
      );
    }
  );
}

export async function clearReminderData(db: PrismaClient) {
  await db.notification.deleteMany();
  await db.reminderOccurrence.deleteMany();
  await db.reminderPreference.deleteMany();
  await db.contract.deleteMany();
  await db.auditLog.deleteMany();
}
